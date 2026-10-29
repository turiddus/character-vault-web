import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.util.Base64;
import java.util.Properties;

class CVSigningCheck {
    static String property(Properties p, String name) {
        if ("base64-utf8".equals(p.getProperty("signingFormat"))) {
            String encoded = p.getProperty(name + "Base64");
            if (encoded == null) throw new IllegalStateException("Missing signing field: " + name);
            return new String(Base64.getDecoder().decode(encoded.trim()), StandardCharsets.UTF_8);
        }
        String value = p.getProperty(name);
        if (value == null) throw new IllegalStateException("Missing signing field: " + name);
        return value;
    }

    static String sha1(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-1").digest(bytes);
        StringBuilder result = new StringBuilder();
        for (byte b : digest) {
            if (result.length() > 0) result.append(":");
            result.append(String.format("%02X", b & 0xff));
        }
        return result.toString();
    }

    public static void main(String[] args) {
        try {
            if (args.length != 1) throw new IllegalArgumentException("Expected a keystore.properties path");
            File propertiesFile = new File(args[0]);
            Properties p = new Properties();
            try (FileInputStream in = new FileInputStream(propertiesFile)) { p.load(in); }
            String keyFileName = p.getProperty("storeFile");
            if (keyFileName == null || keyFileName.isBlank()) throw new IllegalStateException("Missing storeFile");
            String alias = property(p, "keyAlias");
            String storePass = property(p, "storePassword");
            String keyPass = property(p, "keyPassword");
            if (alias.isBlank()) throw new IllegalStateException("Alias is empty in the Gradle properties");
            File storeFile = new File(propertiesFile.getParentFile(), keyFileName);
            if (!storeFile.isFile()) throw new IllegalStateException("Signing keystore missing");
            KeyStore store = KeyStore.getInstance(storeFile, storePass.toCharArray());
            if (!store.isKeyEntry(alias)) throw new IllegalStateException("Alias does not identify a private key");
            Key key = store.getKey(alias, keyPass.toCharArray());
            if (!(key instanceof PrivateKey)) throw new IllegalStateException("Private key cannot be decrypted");
            Certificate certificate = store.getCertificate(alias);
            if (certificate == null) throw new IllegalStateException("Signing certificate missing");
            System.out.println("[SIGNING] Gradle properties: key, passwords, alias and copy verified.");
            System.out.println("[SIGNING] Confirmed SHA-1: " + sha1(certificate.getEncoded()));
        } catch (Exception ex) {
            // Never echo values from properties, keystore, or credentials.
            System.err.println("[SIGNING ERROR] Gradle-format keystore verification failed (" +
                               ex.getClass().getSimpleName() + ").");
            System.err.println("[SIGNING ERROR] Keep the original keystore; do not uninstall the Android app.");
            System.exit(1);
        }
    }
}
