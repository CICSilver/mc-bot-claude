$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$jdk = 'E:\MinecraftTools\xiaoke\jdk\jdk-25.0.4.1+1\bin'
$downloads = 'E:\MinecraftTools\xiaoke\downloads'
$classes = Join-Path $root 'build\classes'
$deps = Join-Path $root 'build\deps'
New-Item -ItemType Directory -Path $classes,$deps -Force | Out-Null
$loader = Join-Path $downloads 'fabric-loader-0.19.5.jar'
if (-not (Test-Path -LiteralPath $loader)) {
    Invoke-WebRequest 'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar' -OutFile $loader
}
$api = [IO.Compression.ZipFile]::OpenRead((Join-Path $downloads 'fabric-api-0.155.3+26.1.2.jar'))
try {
    foreach ($entry in $api.Entries) {
        if ($entry.FullName -match 'META-INF/jars/(fabric-api-base|fabric-lifecycle-events-v1)-') {
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $deps $entry.Name),$true)
        }
    }
} finally { $api.Dispose() }
$cp = @('E:\26.1\versions\26.1\26.1.jar',$loader,(Join-Path $downloads 'CustomPlayerModels-Fabric-26.1-0.6.27b.jar'))
$cp += Get-ChildItem -LiteralPath 'E:\26.1\libraries' -Filter '*.jar' -Recurse | Select-Object -ExpandProperty FullName
$cp += Get-ChildItem -LiteralPath $deps -Filter '*.jar' | Select-Object -ExpandProperty FullName
$classpath = $cp -join ';'
$source = Get-ChildItem -LiteralPath (Join-Path $root 'src') -Filter '*.java' -Recurse | Select-Object -ExpandProperty FullName
& (Join-Path $jdk 'javac.exe') -encoding UTF-8 --release 25 -cp $classpath -d $classes $source
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }
& (Join-Path $jdk 'java.exe') -cp "$classes;$classpath" TargetRuleTest
if ($LASTEXITCODE -ne 0) { throw 'Target tests failed' }
& (Join-Path $jdk 'java.exe') -cp "$classes;$classpath" local.xiaoke.PackModel (Join-Path $root 'build\xiaoke-native-package.b64') (Join-Path $root 'build\xiaoke-maid.cpmmodel')
if ($LASTEXITCODE -ne 0) { throw 'CPM native model verification failed' }
$stage = Join-Path $root 'build\jar-stage'
New-Item -ItemType Directory -Path "$stage\assets\xiaoke_avatar","$stage\local\xiaoke" -Force | Out-Null
Copy-Item -LiteralPath "$root\resources\fabric.mod.json" -Destination "$stage\fabric.mod.json"
Copy-Item -LiteralPath "$root\build\xiaoke-maid.cpmmodel" -Destination "$stage\assets\xiaoke_avatar\xiaoke-maid.cpmmodel"
Get-ChildItem -LiteralPath "$classes\local\xiaoke" -Filter '*.class' | Where-Object { $_.Name -notlike 'PackModel*' } | Copy-Item -Destination "$stage\local\xiaoke"
& (Join-Path $jdk 'jar.exe') --create --file "$root\build\xiaoke-avatar-0.1.0.jar" -C $stage .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
Get-FileHash -LiteralPath "$root\build\xiaoke-avatar-0.1.0.jar","$root\build\xiaoke-maid.cpmmodel" -Algorithm SHA256
