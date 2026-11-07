package io.github.nahur1.unison;
import java.io.File;
import java.io.IOException;
final class LocalMedia {
    static File requireImported(File filesDir, String path) throws IOException {
        if(path==null)throw new IOException("Missing media file");
        File root=new File(filesDir,"media").getCanonicalFile();
        File file=new File(path).getCanonicalFile();
        if(!file.getPath().startsWith(root.getPath()+File.separator)||!file.isFile())
            throw new IOException("File is not in the imported library");
        return file;
    }
}
