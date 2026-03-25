package com.navpay.phonepe.unidbg;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

final class ChEmulation {

    private static final byte[] AES = "AES".getBytes(StandardCharsets.UTF_8);
    private static final byte[] AES_ECB_PKCS5 = "AES/ECB/PKCS5Padding".getBytes(StandardCharsets.UTF_8);
    private static final byte[] AES_GCM = "AES/GCM/NoPadding".getBytes(StandardCharsets.UTF_8);
    private static final byte[] GCM_TAG_BITS = "128".getBytes(StandardCharsets.UTF_8);
    private static final SecureRandom RANDOM = new SecureRandom();

    private ChEmulation() {
    }

    static byte[] ba(byte[] input) throws Exception {
        return digest("SHA-1", input);
    }

    static byte[] b(byte[] input) throws Exception {
        return digest("SHA-256", input);
    }

    static byte[] crb(byte[] input) {
        return Base64.getEncoder().encode(input);
    }

    static byte[] fd(String deviceId) {
        return deviceId.getBytes(StandardCharsets.UTF_8);
    }

    static byte[] ebr(long timeMs) {
        return String.valueOf(timeMs).getBytes(StandardCharsets.UTF_8);
    }

    static byte[] as(byte[] keyBytes, byte[] plainText) throws Exception {
        SecretKeySpec secretKeySpec = new SecretKeySpec(Arrays.copyOfRange(keyBytes, 0, 16), new String(AES, StandardCharsets.UTF_8));
        Cipher cipher = Cipher.getInstance(new String(AES_GCM, StandardCharsets.UTF_8));
        byte[] iv = new byte[12];
        RANDOM.nextBytes(iv);
        cipher.init(Cipher.ENCRYPT_MODE, secretKeySpec,
                new GCMParameterSpec(Integer.parseInt(new String(GCM_TAG_BITS, StandardCharsets.UTF_8)), iv));
        byte[] encrypted = cipher.doFinal(plainText);
        byte[] out = new byte[iv.length + encrypted.length];
        System.arraycopy(iv, 0, out, 0, iv.length);
        System.arraycopy(encrypted, 0, out, iv.length, encrypted.length);
        return out;
    }

    static byte[] a(byte[] keyBytes, byte[] plainText) throws Exception {
        SecretKeySpec secretKeySpec = new SecretKeySpec(Arrays.copyOfRange(keyBytes, 0, 16), new String(AES, StandardCharsets.UTF_8));
        Cipher cipher = Cipher.getInstance(new String(AES_ECB_PKCS5, StandardCharsets.UTF_8));
        cipher.init(Cipher.ENCRYPT_MODE, secretKeySpec);
        return cipher.doFinal(plainText);
    }

    private static byte[] digest(String algorithm, byte[] input) throws Exception {
        MessageDigest digest = MessageDigest.getInstance(algorithm);
        digest.update(input);
        return digest.digest();
    }
}
