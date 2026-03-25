package com.navpay.phonepe.unidbg;

import com.github.unidbg.AndroidEmulator;
import com.github.unidbg.Module;
import com.github.unidbg.ModuleListener;
import com.github.unidbg.arm.backend.BackendException;
import com.github.unidbg.linux.android.AndroidEmulatorBuilder;
import com.github.unidbg.linux.android.AndroidResolver;
import com.github.unidbg.linux.android.dvm.AbstractJni;
import com.github.unidbg.linux.android.dvm.BaseVM;
import com.github.unidbg.linux.android.dvm.DalvikModule;
import com.github.unidbg.linux.android.dvm.DvmClass;
import com.github.unidbg.linux.android.dvm.DvmObject;
import com.github.unidbg.linux.android.dvm.StringObject;
import com.github.unidbg.linux.android.dvm.VM;
import com.github.unidbg.linux.android.dvm.VaList;
import com.github.unidbg.linux.android.dvm.VarArg;
import com.github.unidbg.linux.android.dvm.array.ArrayObject;
import com.github.unidbg.linux.android.dvm.array.ByteArray;
import com.github.unidbg.pointer.UnidbgPointer;
import com.github.unidbg.memory.Memory;

import java.io.File;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

public final class UnidbgChecksumProbe extends AbstractJni {

    private static final String ENCRYPTION_CLASS = "com/phonepe/networkclient/rest/EncryptionUtils";
    private static final String REQUEST_ENCRYPTION_CLASS = "com/phonepe/network/external/encryption/RequestEncryptionUtils";
    private static final String NMCS_SIG = "nmcs([B[B[BLjava/lang/Object;)[B";
    private static final String JNI_ON_LOAD = "JNI_OnLoad";
    private static final String DEFAULT_SIGNATURE_HEX = "30820122300d06092a864886f70d01010105000382010f00";

    private Map<String, String> activeReport;
    private String chMode = "emulate";
    private String configuredDeviceId = "stub-device-id";
    private long configuredTimeMs = 1700000000000L;
    private String configuredApkPath = "/data/app/com.phonepe.app/base.apk";
    private byte[] configuredSignatureBytes = DEFAULT_SIGNATURE_HEX.getBytes(StandardCharsets.UTF_8);
    private int chFallbackHits;
    private int stubHits;

    private static final List<String> CANDIDATE_CLASSES = Collections.unmodifiableList(Arrays.asList(
            ENCRYPTION_CLASS,
            REQUEST_ENCRYPTION_CLASS
    ));

    private static final List<String> CANDIDATE_SIGNATURES = Collections.unmodifiableList(Arrays.asList(
            NMCS_SIG,
            "imcv([B[B[B[BJLjava/lang/Object;)Z",
            "mc([B[B[BLjava/lang/Object;)[B",
            "nimcv([B[B[B[BJLjava/lang/Object;)Z",
            "nimcvs([B[B[B[B[BJLjava/lang/Object;)Z",
            "nmc([B[B[BLjava/lang/Object;)[B",
            "k(I)B"
    ));

    public static void main(String[] args) {
        if (args.length < 3) {
            System.err.println("Usage: UnidbgChecksumProbe <lib_e755b7.so> <path> <uuid> [body]");
            System.exit(2);
        }

        String libPath = args[0];
        String path = args[1];
        String uuid = args[2];
        String body = args.length >= 4 ? args[3] : "";
        String loadOrder = readConfig("probe.load.order", "PROBE_LOAD_ORDER", "e755b7-first");
        boolean loadLibcxx = isTruthy(readConfig("probe.load.libcxx", "PROBE_LOAD_LIBCXX", "false"));

        Map<String, String> report = new LinkedHashMap<>();
        report.put("probe", "unidbg-nmcs");
        report.put("library", libPath);
        report.put("path", path);
        report.put("uuid", uuid);
        report.put("load_order", loadOrder);
        report.put("load_libcxx", String.valueOf(loadLibcxx));
        report.put("probe_candidates", String.join(",", CANDIDATE_CLASSES));
        report.put("probe_signatures", String.join(",", CANDIDATE_SIGNATURES));

        UnidbgChecksumProbe probe = new UnidbgChecksumProbe();
        try {
            String checksum = probe.run(libPath, path, body, uuid, loadOrder, loadLibcxx, report);
            report.put("result", "PASS");
            report.put("checksum", checksum);
            printReport(report);
            System.exit(0);
        } catch (Throwable t) {
            report.put("result", "FAIL");
            report.put("error_type", t.getClass().getName());
            report.put("error", String.valueOf(t.getMessage()));
            printReport(report);
            t.printStackTrace(System.err);
            System.exit(1);
        }
    }

    private String run(String libPath, String path, String body, String uuid, String loadOrder, boolean loadLibcxx,
                       Map<String, String> report) {
        this.activeReport = report;
        this.chMode = readConfig("probe.ch.mode", "PROBE_CH_MODE", "emulate");
        this.configuredDeviceId = readConfig("probe.device.id", "PROBE_DEVICE_ID", "stub-device-id");
        this.configuredTimeMs = Long.parseLong(readConfig("probe.fixed.time.ms", "PROBE_FIXED_TIME_MS",
                String.valueOf(System.currentTimeMillis())));
        this.configuredApkPath = readConfig("probe.target.apk", "PROBE_TARGET_APK", "/data/app/com.phonepe.app/base.apk");
        this.configuredSignatureBytes = resolveSignatureBytes(configuredApkPath, report);
        this.chFallbackHits = 0;
        this.stubHits = 0;
        report.put("probe_ch_mode", chMode);
        report.put("probe_device_id", configuredDeviceId);
        report.put("probe_time_ms", Long.toString(configuredTimeMs));
        report.put("probe_target_apk", configuredApkPath);
        AndroidEmulator emulator = AndroidEmulatorBuilder.for64Bit().setProcessName("com.phonepe.app").build();
        try {
            Memory memory = emulator.getMemory();
            memory.setLibraryResolver(new AndroidResolver(23));

            List<String> loadedModules = new ArrayList<>();
            memory.addModuleListener(new ModuleListener() {
                @Override
                public void onLoaded(com.github.unidbg.Emulator<?> emulator, Module module) {
                    loadedModules.add(module.name + "@0x" + Long.toHexString(module.base));
                }
            });

            VM vm = emulator.createDalvikVM((File) null);
            vm.setJni(this);
            vm.setVerbose(false);

            File libFile = new File(libPath);
            if (!libFile.isFile()) {
                throw new IllegalArgumentException("library not found: " + libPath);
            }
            File libcxxFile = new File(libFile.getParentFile(), "libc++_shared.so");

            if ("libcxx-first".equals(loadOrder)) {
                if (loadLibcxx) {
                    loadLibrary(emulator, vm, libcxxFile, "libcxx_shared", false, report);
                }
                DalvikModule eModule = loadLibrary(emulator, vm, libFile, "e755b7", true, report);
                report.put("e755b7_module", eModule.getModule().name);
            } else {
                DalvikModule eModule = loadLibrary(emulator, vm, libFile, "e755b7", true, report);
                report.put("e755b7_module", eModule.getModule().name);
                if (loadLibcxx) {
                    loadLibrary(emulator, vm, libcxxFile, "libcxx_shared", false, report);
                }
            }

            report.put("loaded_modules", String.join(" | ", loadedModules));

            probeRegistration(vm, emulator, report);
            String checksum = probeChecksum(vm, emulator, path, body, uuid, report);
            report.put("stub_hits", Integer.toString(stubHits));
            report.put("ch_fallback_hits", Integer.toString(chFallbackHits));
            return checksum;
        } catch (BackendException be) {
            throw new IllegalStateException("unidbg backend exception: " + be.getMessage(), be);
        } finally {
            this.activeReport = null;
            try {
                emulator.close();
            } catch (Exception ignored) {
            }
        }
    }

    private DalvikModule loadLibrary(AndroidEmulator emulator, VM vm, File file, String label, boolean callJniOnLoad,
                                     Map<String, String> report) {
        if (!file.isFile()) {
            throw new IllegalArgumentException("library not found: " + file.getAbsolutePath());
        }

        DalvikModule module = vm.loadLibrary(file, false);
        Module so = module.getModule();
        report.put(label + "_module_path", so.name);
        report.put(label + "_base", "0x" + Long.toHexString(so.base));
        report.put(label + "_size", Long.toString(so.size));

        if (callJniOnLoad) {
            if (so.findSymbolByName(JNI_ON_LOAD, false) != null) {
                module.callJNI_OnLoad(emulator);
                report.put(label + "_jni_onload", "ok");
            } else {
                report.put(label + "_jni_onload", "skip-no-symbol");
            }
        } else {
            if (so.findSymbolByName(JNI_ON_LOAD, false) != null) {
                try {
                    module.callJNI_OnLoad(emulator);
                    report.put(label + "_jni_onload", "ok");
                } catch (Throwable t) {
                    report.put(label + "_jni_onload", "fail:" + sanitize(t));
                }
            } else {
                report.put(label + "_jni_onload", "skip-no-symbol");
            }
        }

        return module;
    }

    private void probeRegistration(VM vm, AndroidEmulator emulator, Map<String, String> report) {
        for (String className : CANDIDATE_CLASSES) {
            DvmClass dvmClass = vm.resolveClass(className);
            String prefix = toKey(className);
            report.put(prefix + ".registered", snapshotNativeKeys(dvmClass));
            for (String signature : CANDIDATE_SIGNATURES) {
                String probeKey = prefix + ".find_" + signatureKey(signature);
                try {
                    UnidbgPointer pointer = dvmClass.findNativeFunction(emulator, signature);
                    report.put(probeKey, pointer == null ? "MISS" : "0x" + Long.toHexString(pointer.peer));
                } catch (Throwable t) {
                    report.put(probeKey, "ERR:" + sanitize(t));
                }
            }
        }
    }

    private String probeChecksum(VM vm, AndroidEmulator emulator, String path, String body, String uuid,
                                 Map<String, String> report) {
        ByteArray pathBytes = new ByteArray(vm, path.getBytes(StandardCharsets.UTF_8));
        ByteArray bodyBytes = new ByteArray(vm, body.getBytes(StandardCharsets.UTF_8));
        ByteArray uuidBytes = new ByteArray(vm, uuid.getBytes(StandardCharsets.UTF_8));
        DvmClass contextClass = vm.resolveClass("android/content/Context");
        DvmObject<?> contextObj = contextClass.newObject("stub-context");

        List<String> attempts = new ArrayList<>();
        for (String className : CANDIDATE_CLASSES) {
            DvmClass dvmClass = vm.resolveClass(className);
            String attemptKey = toKey(className) + ".call_nmcs";
            try {
                DvmObject<?> ret = dvmClass.callStaticJniMethodObject(emulator, NMCS_SIG, pathBytes, bodyBytes, uuidBytes, contextObj);
                if (!(ret instanceof ByteArray)) {
                    throw new IllegalStateException("nmcs return type unexpected: " + ret);
                }
                byte[] value = ((ByteArray) ret).getValue();
                if (value == null || value.length == 0) {
                    throw new IllegalStateException("nmcs returned empty bytes");
                }
                String checksum = new String(value, StandardCharsets.UTF_8);
                report.put(attemptKey, "PASS");
                report.put("checksum_source", className);
                report.put("checksum_length", Integer.toString(value.length));
                report.put("checksum_preview", checksum.length() > 32 ? checksum.substring(0, 32) : checksum);
                return checksum;
            } catch (Throwable t) {
                String failure = sanitize(t);
                report.put(attemptKey, "FAIL:" + failure);
                attempts.add(className + "=" + failure);
            }
        }

        throw new IllegalStateException("nmcs unresolved on candidates: " + String.join(" | ", attempts));
    }

    @Override
    public DvmObject<?> callObjectMethod(BaseVM vm, DvmObject<?> dvmObject, String signature, VarArg varArg) {
        DvmObject<?> stub = resolveObjectMethodWithTrace(vm, dvmObject, signature, varArg);
        if (stub != null) {
            return stub;
        }
        return super.callObjectMethod(vm, dvmObject, signature, varArg);
    }

    @Override
    public DvmObject<?> callObjectMethodV(BaseVM vm, DvmObject<?> dvmObject, String signature, VaList vaList) {
        DvmObject<?> stub = resolveObjectMethodWithTrace(vm, dvmObject, signature, null);
        if (stub != null) {
            return stub;
        }
        return super.callObjectMethodV(vm, dvmObject, signature, vaList);
    }

    @Override
    public DvmObject<?> getObjectField(BaseVM vm, DvmObject<?> dvmObject, String signature) {
        if ("android/content/pm/PackageInfo->signatures:[Landroid/content/pm/Signature;".equals(signature)) {
            recordStubHit("getObjectField", signature, "default-signature-array");
            DvmObject<?> sig = vm.resolveClass("android/content/pm/Signature")
                    .newObject(configuredSignatureBytes);
            return new ArrayObject(sig);
        }
        return super.getObjectField(vm, dvmObject, signature);
    }

    private DvmObject<?> resolveObjectMethod(BaseVM vm, DvmObject<?> dvmObject, String signature, VarArg varArg) {
        if ("java/util/UUID->toString()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, String.valueOf(dvmObject.getValue()));
        }
        if ("android/content/Context->getApplicationContext()Landroid/content/Context;".equals(signature)) {
            return dvmObject;
        }
        if ("android/content/Context->getPackageName()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, "com.phonepe.app");
        }
        if ("android/content/Context->getPackageCodePath()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, configuredApkPath);
        }
        if ("android/content/Context->getClassLoader()Ljava/lang/ClassLoader;".equals(signature)) {
            return vm.resolveClass("java/lang/ClassLoader").newObject("stub-classloader");
        }
        if ("android/content/Context->getPackageManager()Landroid/content/pm/PackageManager;".equals(signature)) {
            return vm.resolveClass("android/content/pm/PackageManager").newObject("stub-pm");
        }
        if ("android/content/Context->getFilesDir()Ljava/io/File;".equals(signature)) {
            return vm.resolveClass("java/io/File").newObject("/data/user/0/com.phonepe.app/files");
        }
        if ("android/content/Context->getCacheDir()Ljava/io/File;".equals(signature)) {
            return vm.resolveClass("java/io/File").newObject("/data/user/0/com.phonepe.app/cache");
        }
        if ("android/content/Context->getDir(Ljava/lang/String;I)Ljava/io/File;".equals(signature)) {
            String name = "tmp";
            if (varArg != null) {
                DvmObject<?> arg = varArg.getObjectArg(0);
                if (arg != null && arg.getValue() != null) {
                    name = String.valueOf(arg.getValue());
                }
            }
            return vm.resolveClass("java/io/File").newObject("/data/user/0/com.phonepe.app/app_" + name);
        }
        if ("android/content/Context->getApplicationInfo()Landroid/content/pm/ApplicationInfo;".equals(signature)) {
            return vm.resolveClass("android/content/pm/ApplicationInfo").newObject("stub-app-info");
        }
        if ("android/content/pm/PackageManager->getPackageInfo(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;".equals(signature)) {
            return vm.resolveClass("android/content/pm/PackageInfo").newObject("stub-package-info");
        }
        if ("android/content/pm/Signature->toByteArray()[B".equals(signature)) {
            return new ByteArray(vm, configuredSignatureBytes);
        }
        if ("java/io/File->getAbsolutePath()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, String.valueOf(dvmObject.getValue()));
        }
        if ("java/io/File->getPath()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, String.valueOf(dvmObject.getValue()));
        }
        return null;
    }

    private byte[] resolveSignatureBytes(String apkPath, Map<String, String> report) {
        File apkFile = new File(apkPath);
        if (!apkFile.isFile()) {
            report.put("probe_signature_source", "fallback-default");
            return DEFAULT_SIGNATURE_HEX.getBytes(StandardCharsets.UTF_8);
        }
        try {
            byte[] bytes = ApkSignatureExtractor.extractFirstCertificate(apkFile);
            report.put("probe_signature_source", "apk-cert");
            report.put("probe_signature_length", Integer.toString(bytes.length));
            return bytes;
        } catch (Exception e) {
            report.put("probe_signature_source", "fallback-default:" + sanitize(e));
            return DEFAULT_SIGNATURE_HEX.getBytes(StandardCharsets.UTF_8);
        }
    }

    private DvmObject<?> resolveObjectMethodWithTrace(BaseVM vm, DvmObject<?> dvmObject, String signature, VarArg varArg) {
        DvmObject<?> obj = resolveObjectMethod(vm, dvmObject, signature, varArg);
        if (obj != null) {
            recordStubHit("callObjectMethod", signature, describeValue(obj.getValue()));
        }
        return obj;
    }

    @Override
    public DvmObject<?> callStaticObjectMethod(BaseVM vm, DvmClass dvmClass, String signature, VarArg varArg) {
        DvmObject<?> firstArg = null;
        DvmObject<?> secondArg = null;
        if (varArg != null) {
            try {
                firstArg = varArg.getObjectArg(0);
            } catch (Throwable ignored) {
            }
            try {
                secondArg = varArg.getObjectArg(1);
            } catch (Throwable ignored) {
            }
        }
        DvmObject<?> chFallback = resolveChStaticByteArrayFallback(vm, signature, firstArg, secondArg);
        if (chFallback != null) {
            return chFallback;
        }
        if ("java/util/UUID->randomUUID()Ljava/util/UUID;".equals(signature)) {
            recordStubHit("callStaticObjectMethod", signature, "fixed-uuid");
            return vm.resolveClass("java/util/UUID").newObject("00000000-0000-0000-0000-000000000000");
        }
        return super.callStaticObjectMethod(vm, dvmClass, signature, varArg);
    }

    @Override
    public DvmObject<?> callStaticObjectMethodV(BaseVM vm, DvmClass dvmClass, String signature, VaList vaList) {
        DvmObject<?> firstArg = null;
        DvmObject<?> secondArg = null;
        if (vaList != null) {
            try {
                firstArg = vaList.getObjectArg(0);
            } catch (Throwable ignored) {
            }
            try {
                secondArg = vaList.getObjectArg(1);
            } catch (Throwable ignored) {
            }
        }
        DvmObject<?> chFallback = resolveChStaticByteArrayFallback(vm, signature, firstArg, secondArg);
        if (chFallback != null) {
            return chFallback;
        }
        return super.callStaticObjectMethodV(vm, dvmClass, signature, vaList);
    }

    @Override
    public void callStaticVoidMethodV(BaseVM vm, DvmClass dvmClass, String signature, VaList vaList) {
        if (signature.startsWith("com/phonepe/networkclient/utils/CH->")) {
            recordChFallback(signature, "void");
            return;
        }
        super.callStaticVoidMethodV(vm, dvmClass, signature, vaList);
    }

    private DvmObject<?> resolveChStaticByteArrayFallback(BaseVM vm, String signature, DvmObject<?> firstArg,
                                                          DvmObject<?> secondArg) {
        if (!signature.startsWith("com/phonepe/networkclient/utils/CH->")) {
            return null;
        }
        if (!signature.endsWith(")[B")) {
            return null;
        }
        DvmObject<?> emulated = tryEmulateCh(vm, signature, firstArg, secondArg);
        if (emulated != null) {
            return emulated;
        }
        if ("disable".equals(chMode)) {
            recordChFallback(signature, "disabled");
            return null;
        }
        if ("empty".equals(chMode)) {
            recordChFallback(signature, "empty-bytes");
            return new ByteArray(vm, new byte[0]);
        }
        if (firstArg instanceof ByteArray) {
            recordChFallback(signature, "passthrough-first-arg");
            return firstArg;
        }
        recordChFallback(signature, "empty-bytes");
        return new ByteArray(vm, new byte[0]);
    }

    private DvmObject<?> tryEmulateCh(BaseVM vm, String signature, DvmObject<?> firstArg, DvmObject<?> secondArg) {
        if (!"emulate".equals(chMode)) {
            return null;
        }
        try {
            if ("com/phonepe/networkclient/utils/CH->a([B[B)[B".equals(signature)
                    && firstArg instanceof ByteArray && secondArg instanceof ByteArray) {
                byte[] value = ChEmulation.a(((ByteArray) firstArg).getValue(), ((ByteArray) secondArg).getValue());
                recordChFallback(signature, "emulate-aes-ecb");
                return new ByteArray(vm, value);
            }
            if ("com/phonepe/networkclient/utils/CH->ba([B)[B".equals(signature) && firstArg instanceof ByteArray) {
                byte[] value = ChEmulation.ba(((ByteArray) firstArg).getValue());
                recordChFallback(signature, "emulate-sha1");
                return new ByteArray(vm, value);
            }
            if ("com/phonepe/networkclient/utils/CH->b([B)[B".equals(signature) && firstArg instanceof ByteArray) {
                byte[] value = ChEmulation.b(((ByteArray) firstArg).getValue());
                recordChFallback(signature, "emulate-sha256");
                return new ByteArray(vm, value);
            }
            if ("com/phonepe/networkclient/utils/CH->crb([B)[B".equals(signature) && firstArg instanceof ByteArray) {
                byte[] value = ChEmulation.crb(((ByteArray) firstArg).getValue());
                recordChFallback(signature, "emulate-base64");
                return new ByteArray(vm, value);
            }
            if ("com/phonepe/networkclient/utils/CH->fd()[B".equals(signature)) {
                byte[] value = ChEmulation.fd(configuredDeviceId);
                recordChFallback(signature, "emulate-device-id");
                return new ByteArray(vm, value);
            }
            if ("com/phonepe/networkclient/utils/CH->ebr()[B".equals(signature)) {
                byte[] value = ChEmulation.ebr(configuredTimeMs);
                recordChFallback(signature, "emulate-time");
                return new ByteArray(vm, value);
            }
            if ("com/phonepe/networkclient/utils/CH->as([B[B)[B".equals(signature)
                    && firstArg instanceof ByteArray && secondArg instanceof ByteArray) {
                byte[] value = ChEmulation.as(((ByteArray) firstArg).getValue(), ((ByteArray) secondArg).getValue());
                recordChFallback(signature, "emulate-aes-gcm");
                return new ByteArray(vm, value);
            }
        } catch (Exception e) {
            recordChFallback(signature, "emulate-failed:" + e.getClass().getSimpleName());
            return null;
        }
        return null;
    }

    private void recordChFallback(String signature, String behavior) {
        chFallbackHits++;
        recordReportValue("ch." + chFallbackHits, signature + " => " + behavior);
    }

    private void recordStubHit(String prefix, String signature, String value) {
        stubHits++;
        recordReportValue(prefix + "." + stubHits, signature + " => " + value);
    }

    private void recordReportValue(String key, String value) {
        if (activeReport != null) {
            activeReport.put(key, sanitize(value));
        }
    }

    private static String describeValue(Object value) {
        if (value instanceof byte[]) {
            return "byte[" + ((byte[]) value).length + "]";
        }
        return String.valueOf(value);
    }

    private static String snapshotNativeKeys(DvmClass dvmClass) {
        try {
            Field field = DvmClass.class.getDeclaredField("nativesMap");
            field.setAccessible(true);
            @SuppressWarnings("unchecked")
            Map<String, UnidbgPointer> nativesMap = (Map<String, UnidbgPointer>) field.get(dvmClass);
            if (nativesMap == null || nativesMap.isEmpty()) {
                return "none";
            }
            Set<String> keys = new TreeSet<>(nativesMap.keySet());
            return String.join("|", keys);
        } catch (Throwable t) {
            return "ERR:" + sanitize(t);
        }
    }

    private static String toKey(String className) {
        return className.replace('/', '.');
    }

    private static String signatureKey(String signature) {
        if (NMCS_SIG.equals(signature)) {
            return "nmcs";
        }
        if ("imcv([B[B[B[BJLjava/lang/Object;)Z".equals(signature)) {
            return "imcv";
        }
        if ("mc([B[B[BLjava/lang/Object;)[B".equals(signature)) {
            return "mc";
        }
        if ("nimcv([B[B[B[BJLjava/lang/Object;)Z".equals(signature)) {
            return "nimcv";
        }
        if ("nimcvs([B[B[B[B[BJLjava/lang/Object;)Z".equals(signature)) {
            return "nimcvs";
        }
        if ("nmc([B[B[BLjava/lang/Object;)[B".equals(signature)) {
            return "nmc";
        }
        if ("k(I)B".equals(signature)) {
            return "k";
        }
        return signature.replaceAll("[^A-Za-z0-9_.]+", "_");
    }

    private static String sanitize(Throwable t) {
        return sanitize(t.getClass().getSimpleName() + ":" + t.getMessage());
    }

    private static String sanitize(String value) {
        if (value == null) {
            return "null";
        }
        return value.replace('\n', ' ').replace('\r', ' ');
    }

    private static String readConfig(String propertyKey, String envKey, String defaultValue) {
        String value = System.getProperty(propertyKey);
        if (value != null && !value.isEmpty()) {
            return value;
        }
        value = System.getenv(envKey);
        if (value != null && !value.isEmpty()) {
            return value;
        }
        return defaultValue;
    }

    private static boolean isTruthy(String value) {
        if (value == null) {
            return false;
        }
        String normalized = value.trim().toLowerCase();
        return "1".equals(normalized) || "true".equals(normalized) || "yes".equals(normalized) || "on".equals(normalized);
    }

    private static void printReport(Map<String, String> report) {
        for (Map.Entry<String, String> e : report.entrySet()) {
            System.out.println(e.getKey() + "=" + e.getValue());
        }
    }
}
