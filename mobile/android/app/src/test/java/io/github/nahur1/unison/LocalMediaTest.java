package io.github.nahur1.unison;
import static org.junit.Assert.*;
import java.io.File;
import java.nio.file.Files;
import org.junit.Test;
public class LocalMediaTest {
    @Test public void onlyImportedFilesCanBePlayedOrDeleted() throws Exception {
        File root=Files.createTempDirectory("unison-test").toFile();
        File folder=new File(root,"media");folder.mkdirs();
        File own=new File(folder,"song.wav");own.createNewFile();
        assertEquals(own.getCanonicalFile(),LocalMedia.requireImported(root,own.getPath()));
        File outside=new File(root,"private.txt");outside.createNewFile();
        assertThrows(java.io.IOException.class,()->LocalMedia.requireImported(root,outside.getPath()));
        assertThrows(java.io.IOException.class,()->LocalMedia.requireImported(root,new File(folder,"../private.txt").getPath()));
        assertThrows(java.io.IOException.class,()->LocalMedia.requireImported(root,null));
        assertThrows(java.io.IOException.class,()->LocalMedia.requireImported(root,folder.getPath()));
        own.delete();folder.delete();outside.delete();root.delete();
    }
}
