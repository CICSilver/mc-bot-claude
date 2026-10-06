package local.xiaoke;

import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Base64;
import com.tom.cpm.shared.definition.Link;
import com.tom.cpm.shared.io.ChecksumOutputStream;
import com.tom.cpm.shared.io.IOHelper;
import com.tom.cpm.shared.io.ModelFile;
import com.tom.cpm.shared.model.SkinType;
import com.tom.cpm.shared.parts.ModelPartDefinitionLink;
import com.tom.cpm.shared.parts.ModelPartEnd;
import com.tom.cpm.shared.parts.ModelPartSkinType;

/** Packages the editor's native overflow data locally, without a paste service. */
public final class PackModel {
    public static void main(String[] args) throws Exception {
        byte[] overflow = Base64.getDecoder().decode(Files.readString(Path.of(args[0])).trim());
        if (overflow.length < 100 || overflow[0] != 0x53) throw new IllegalArgumentException("Invalid CPM package");
        int sum = 0;
        for (int i = 1; i < overflow.length - 2; i++) sum = (sum + (overflow[i] & 255)) & 65535;
        int expected = (overflow[overflow.length - 2] & 255) * 256 + (overflow[overflow.length - 1] & 255);
        if (sum != expected) throw new IllegalArgumentException("Native package checksum mismatch");
        Link local = new Link("local", "xiaoke-maid-v1");
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        buffer.write(0x53);
        try (IOHelper out = new IOHelper(new ChecksumOutputStream(buffer))) {
            out.writeObjectBlock(new ModelPartSkinType(SkinType.DEFAULT));
            out.writeObjectBlock(new ModelPartDefinitionLink(local));
            out.writeObjectBlock(ModelPartEnd.END);
        }
        byte[] data = buffer.toByteArray();
        try (FileOutputStream file = new FileOutputStream(args[1])) {
            file.write(0x53);
            try (IOHelper out = new IOHelper(new ChecksumOutputStream(file))) {
                out.writeUTF("Xiaoke - Ivory Maid");
                out.writeUTF("Local avatar for clawd. Model and textures embedded; no external hosting.");
                out.writeByteArray(data);
                out.writeByteArray(overflow);
                local.write(out);
                out.writeVarInt(0);
            }
        }
        ModelFile verified = ModelFile.load(Path.of(args[1]).toFile());
        if (!Arrays.equals(verified.getDataBlock(), data)) throw new IllegalStateException("Round-trip failed");
        System.out.println("CPM package checksum and native ModelFile round-trip passed. Bytes: " + Files.size(Path.of(args[1])));
    }
}
