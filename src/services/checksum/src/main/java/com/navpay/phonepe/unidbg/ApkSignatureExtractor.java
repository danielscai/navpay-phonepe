package com.navpay.phonepe.unidbg;

import java.io.File;
import java.io.InputStream;
import java.security.cert.Certificate;
import java.util.Enumeration;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

final class ApkSignatureExtractor {

    private ApkSignatureExtractor() {
    }

    static byte[] extractFirstCertificate(File apkFile) throws Exception {
        try (JarFile jarFile = new JarFile(apkFile, true)) {
            Enumeration<JarEntry> entries = jarFile.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (entry.isDirectory() || entry.getName().startsWith("META-INF/")) {
                    continue;
                }
                try (InputStream in = jarFile.getInputStream(entry)) {
                    byte[] buffer = new byte[8192];
                    while (in.read(buffer) != -1) {
                        // Fully consume to trigger certificate verification.
                    }
                }
                Certificate[] certificates = entry.getCertificates();
                if (certificates != null && certificates.length > 0) {
                    return certificates[0].getEncoded();
                }
            }
        }
        throw new IllegalStateException("No signing certificate found in apk: " + apkFile.getAbsolutePath());
    }
}
