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
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
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
    private static final String NATIVE_LIBRARY_LOADER_CLASS = "com/phonepe/util/NativeLibraryLoader";
    private static final String NATIVE_LIBRARY_LOADER_COMPANION_CLASS = "com/phonepe/util/NativeLibraryLoader$Companion";
    private static final String DEVICE_ID_FETCHER_CLASS = "com/phonepe/network/base/utils/DeviceIdFetcher";
    private static final String DEVICE_ID_CONTRACT_CLASS = "com/phonepe/network/base/utils/DeviceIdContract";
    private static final String SERVER_TIME_OFFSET_CLASS = "com/phonepe/network/base/ServerTimeOffset";
    private static final String SERVER_TIME_OFFSET_COMPANION_CLASS = "com/phonepe/network/base/ServerTimeOffset$Companion";
    private static final String JNMCS_SIG = "jnmcs(Landroid/content/Context;[B[B[BLjava/lang/Object;)[B";
    private static final String NMCS_SIG = "nmcs([B[B[BLjava/lang/Object;)[B";
    private static final String H2_SIG = "h2()Z";
    private static final String LOAD_LIBRARY_SIG = "b()V";
    private static final String JNI_ON_LOAD = "JNI_OnLoad";
    private static final String DEFAULT_SIGNATURE_HEX = "30820122300d06092a864886f70d01010105000382010f00";

    private Map<String, String> activeReport;
    private String chMode = "emulate";
    private String configuredDeviceId = "stub-device-id";
    private long configuredTimeMs = 1700000000000L;
    private String configuredRuntimeRoot = "";
    private String configuredApkPath = "/data/app/com.phonepe.app/base.apk";
    private byte[] configuredSignatureBytes = DEFAULT_SIGNATURE_HEX.getBytes(StandardCharsets.UTF_8);
    private int chFallbackHits;
    private int stubHits;
    private DvmObject<?> applicationContextObject;
    private DvmObject<?> nativeLibraryLoaderObject;
    private DvmObject<?> nativeLibraryLoaderCompanionObject;
    private DvmObject<?> deviceIdFetcherObject;
    private DvmObject<?> deviceIdContractObject;
    private DvmObject<?> serverTimeOffsetCompanionObject;
    private DvmObject<?> serverTimeOffsetObject;
    private boolean nativeLibraryLoaderInitialized;

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

    public Map<String, String> execute(String libPath, String path, String body, String uuid, String loadOrder,
                                       boolean loadLibcxx) {
        Map<String, String> report = new LinkedHashMap<>();
        report.put("probe", "unidbg-nmcs");
        report.put("library", libPath);
        report.put("path", path);
        report.put("uuid", uuid);
        report.put("load_order", loadOrder);
        report.put("load_libcxx", String.valueOf(loadLibcxx));
        report.put("probe_candidates", String.join(",", CANDIDATE_CLASSES));
        report.put("probe_signatures", String.join(",", CANDIDATE_SIGNATURES));
        String checksum = run(libPath, path, body, uuid, loadOrder, loadLibcxx, report);
        report.put("result", "PASS");
        report.put("checksum", checksum);
        return report;
    }

    public static String detectDeviceIdFromAdb() {
        ProcessBuilder processBuilder = new ProcessBuilder("adb", "devices");
        processBuilder.redirectErrorStream(true);
        try {
            Process process = processBuilder.start();
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            int exitCode = process.waitFor();
            if (exitCode != 0) {
                return null;
            }
            for (String line : output.split("\\R")) {
                String[] parts = line.trim().split("\\s+");
                if (parts.length >= 2 && "device".equals(parts[1])) {
                    ProcessBuilder adbGet = new ProcessBuilder("adb", "-s", parts[0], "shell", "settings", "get",
                            "secure", "android_id");
                    adbGet.redirectErrorStream(true);
                    Process adbProcess = adbGet.start();
                    String androidId = new String(adbProcess.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
                    if (adbProcess.waitFor() == 0 && !androidId.isEmpty()) {
                        return androidId;
                    }
                    break;
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    public static String extractLibraryOnce(String apkPath, String libBasename) throws IOException {
        Path root = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        Path workDir = root.resolve("cache/unidbg_probe/lib/arm64-v8a");
        Files.createDirectories(workDir);
        Path target = workDir.resolve(libBasename);
        Path apk = Path.of(apkPath);
        try (java.util.zip.ZipFile zip = new java.util.zip.ZipFile(apk.toFile())) {
            copyZipEntry(zip, "lib/arm64-v8a/" + libBasename, target);
            copyZipEntry(zip, "lib/arm64-v8a/liba41935.so", workDir.resolve("liba41935.so"));
            copyZipEntry(zip, "lib/arm64-v8a/libc++_shared.so", workDir.resolve("libc++_shared.so"));
        }
        return target.toString();
    }

    private static void copyZipEntry(java.util.zip.ZipFile zip, String entryName, Path target) throws IOException {
        java.util.zip.ZipEntry entry = zip.getEntry(entryName);
        if (entry == null) {
            return;
        }
        try (InputStream in = zip.getInputStream(entry)) {
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private String run(String libPath, String path, String body, String uuid, String loadOrder, boolean loadLibcxx,
                       Map<String, String> report) {
        this.activeReport = report;
        this.chMode = readConfig("probe.ch.mode", "PROBE_CH_MODE", "emulate");
        this.configuredRuntimeRoot = readConfig("probe.runtime.root", "PROBE_RUNTIME_ROOT", "");
        ChecksumRuntimeSnapshot runtimeSnapshot = loadRuntimeSnapshot(configuredRuntimeRoot, report);
        this.configuredDeviceId = resolveConfiguredDeviceId(runtimeSnapshot, report);
        this.configuredTimeMs = resolveConfiguredTimeMs(runtimeSnapshot, report);
        this.configuredApkPath = resolveConfiguredApkPath(configuredRuntimeRoot, report);
        this.configuredSignatureBytes = resolveSignatureBytesForConfig(configuredRuntimeRoot, configuredApkPath, report);
        this.chFallbackHits = 0;
        this.stubHits = 0;
        report.put("probe_ch_mode", chMode);
        report.put("probe_device_id", configuredDeviceId);
        report.put("probe_time_ms", Long.toString(configuredTimeMs));
        report.put("probe_runtime_root", configuredRuntimeRoot);
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

            VM vm = emulator.createDalvikVM(resolveApkFileForVm(configuredApkPath, report));
            vm.setJni(this);
            vm.setVerbose(false);

            File libFile = new File(libPath);
            if (!libFile.isFile()) {
                throw new IllegalArgumentException("library not found: " + libPath);
            }
            File bootstrapLibFile = new File(libFile.getParentFile(), "liba41935.so");
            File libcxxFile = new File(libFile.getParentFile(), "libc++_shared.so");

            if ("libcxx-first".equals(loadOrder)) {
                if (loadLibcxx) {
                    loadLibrary(emulator, vm, libcxxFile, "libcxx_shared", false, report);
                }
                if (bootstrapLibFile.isFile()) {
                    loadLibrary(emulator, vm, bootstrapLibFile, "a41935", false, report);
                }
                DalvikModule eModule = loadLibrary(emulator, vm, libFile, "e755b7", true, report);
                report.put("e755b7_module", eModule.getModule().name);
            } else {
                if (bootstrapLibFile.isFile()) {
                    loadLibrary(emulator, vm, bootstrapLibFile, "a41935", false, report);
                }
                DalvikModule eModule = loadLibrary(emulator, vm, libFile, "e755b7", true, report);
                report.put("e755b7_module", eModule.getModule().name);
                if (loadLibcxx) {
                    loadLibrary(emulator, vm, libcxxFile, "libcxx_shared", false, report);
                }
            }

            report.put("loaded_modules", String.join(" | ", loadedModules));

            probeRegistration(vm, emulator, report);
            initializeNativeLibraryLoader(vm, emulator, report);
            String checksum = probeChecksum(vm, emulator, path, body, uuid, report);
            report.put("stub_hits", Integer.toString(stubHits));
            report.put("ch_fallback_hits", Integer.toString(chFallbackHits));
            return checksum;
        } catch (BackendException be) {
            throw new IllegalStateException("unidbg backend exception: " + be.getMessage(), be);
        } finally {
            this.activeReport = null;
            this.applicationContextObject = null;
            this.nativeLibraryLoaderObject = null;
            this.nativeLibraryLoaderCompanionObject = null;
            this.deviceIdFetcherObject = null;
            this.deviceIdContractObject = null;
            this.serverTimeOffsetCompanionObject = null;
            this.serverTimeOffsetObject = null;
            this.nativeLibraryLoaderInitialized = false;
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

    private void initializeNativeLibraryLoader(VM vm, AndroidEmulator emulator, Map<String, String> report) {
        DvmClass loaderClass = vm.resolveClass(NATIVE_LIBRARY_LOADER_CLASS);
        report.put("com.phonepe.util.NativeLibraryLoader.registered", snapshotNativeKeys(loaderClass));
        try {
            boolean initialized = ensureNativeLibraryLoaderInitialized(vm, emulator);
            report.put("native_loader_h2", initialized ? "PASS" : "FAIL:false");
        } catch (Throwable t) {
            report.put("native_loader_h2", "FAIL:" + sanitize(t));
        }
    }

    private String probeChecksum(VM vm, AndroidEmulator emulator, String path, String body, String uuid,
                                 Map<String, String> report) {
        ByteArray pathBytes = new ByteArray(vm, path.getBytes(StandardCharsets.UTF_8));
        ByteArray bodyBytes = new ByteArray(vm, body.getBytes(StandardCharsets.UTF_8));
        ByteArray uuidBytes = new ByteArray(vm, uuid.getBytes(StandardCharsets.UTF_8));
        DvmObject<?> contextObj = createApplicationContextObject(vm);

        List<String> attempts = new ArrayList<>();
        for (String className : CANDIDATE_CLASSES) {
            DvmClass dvmClass = vm.resolveClass(className);
            String wrapperAttemptKey = toKey(className) + ".call_jnmcs";
            String attemptKey = toKey(className) + ".call_nmcs";
            try {
                DvmObject<?> ret = invokeOriginalJnmcs(vm, emulator, className, contextObj, pathBytes, bodyBytes, uuidBytes);
                String checksum = extractChecksum(ret);
                report.put(wrapperAttemptKey, "PASS");
                report.put("checksum_source", className + "#jnmcs");
                report.put("checksum_length", Integer.toString(checksum.getBytes(StandardCharsets.UTF_8).length));
                report.put("checksum_preview", checksum.length() > 32 ? checksum.substring(0, 32) : checksum);
                return checksum;
            } catch (Throwable t) {
                report.put(wrapperAttemptKey, "FAIL:" + sanitize(t));
            }
            try {
                DvmObject<?> ret = dvmClass.callStaticJniMethodObject(emulator, NMCS_SIG, pathBytes, bodyBytes, uuidBytes, contextObj);
                String checksum = extractChecksum(ret);
                report.put(attemptKey, "PASS");
                report.put("checksum_source", className);
                report.put("checksum_length", Integer.toString(checksum.getBytes(StandardCharsets.UTF_8).length));
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

    private DvmObject<?> invokeOriginalJnmcs(VM vm, AndroidEmulator emulator, String className, DvmObject<?> contextObj,
                                             ByteArray pathBytes, ByteArray bodyBytes, ByteArray uuidBytes) {
        if (!ENCRYPTION_CLASS.equals(className)) {
            throw new IllegalArgumentException("find method failed: " + JNMCS_SIG);
        }
        DvmObject<?> appContext = resolveApplicationContextObject(vm, contextObj);
        ensureNativeLibraryLoaderSingleton(vm, appContext);
        ensureNativeLibraryLoaderInitialized(vm, emulator);
        return vm.resolveClass(className).callStaticJniMethodObject(emulator, NMCS_SIG, pathBytes, bodyBytes, uuidBytes, contextObj);
    }

    private DvmObject<?> createApplicationContextObject(VM vm) {
        if (applicationContextObject != null) {
            return applicationContextObject;
        }
        DvmClass contextClass = vm.resolveClass("android/content/Context");
        DvmClass contextWrapperClass = vm.resolveClass("android/content/ContextWrapper", contextClass);
        DvmClass applicationClass = vm.resolveClass("android/app/Application", contextWrapperClass);
        applicationContextObject = applicationClass.newObject("stub-app-context");
        return applicationContextObject;
    }

    private DvmObject<?> resolveApplicationContextObject(VM vm, DvmObject<?> contextObj) {
        return applicationContextObject != null ? applicationContextObject : (contextObj != null ? contextObj : createApplicationContextObject(vm));
    }

    private void ensureNativeLibraryLoaderSingleton(VM vm, DvmObject<?> appContext) {
        if (nativeLibraryLoaderCompanionObject == null) {
            nativeLibraryLoaderCompanionObject = vm.resolveClass(NATIVE_LIBRARY_LOADER_COMPANION_CLASS).newObject("native-loader-companion");
        }
        if (nativeLibraryLoaderObject == null) {
            nativeLibraryLoaderObject = vm.resolveClass(NATIVE_LIBRARY_LOADER_CLASS).newObject(appContext.getValue());
        }
    }

    private boolean ensureNativeLibraryLoaderInitialized(VM vm, AndroidEmulator emulator) {
        ensureNativeLibraryLoaderSingleton(vm, createApplicationContextObject(vm));
        if (nativeLibraryLoaderInitialized) {
            return true;
        }
        boolean initialized = nativeLibraryLoaderObject.callJniMethodBoolean(emulator, H2_SIG);
        nativeLibraryLoaderInitialized = initialized;
        return initialized;
    }

    private String extractChecksum(DvmObject<?> ret) {
        if (!(ret instanceof ByteArray)) {
            throw new IllegalStateException("checksum return type unexpected: " + ret);
        }
        byte[] value = ((ByteArray) ret).getValue();
        if (value == null || value.length == 0) {
            throw new IllegalStateException("checksum returned empty bytes");
        }
        return new String(value, StandardCharsets.UTF_8);
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

    @Override
    public DvmObject<?> getStaticObjectField(BaseVM vm, DvmClass dvmClass, String signature) {
        if ((NATIVE_LIBRARY_LOADER_CLASS + "->e:Lcom/phonepe/util/NativeLibraryLoader$Companion;").equals(signature)) {
            if (nativeLibraryLoaderCompanionObject == null) {
                nativeLibraryLoaderCompanionObject = vm.resolveClass(NATIVE_LIBRARY_LOADER_COMPANION_CLASS).newObject("native-loader-companion");
            }
            recordStubHit("getStaticObjectField", signature, "native-loader-companion");
            return nativeLibraryLoaderCompanionObject;
        }
        if ((NATIVE_LIBRARY_LOADER_CLASS + "->f:Lcom/phonepe/util/NativeLibraryLoader;").equals(signature)) {
            ensureNativeLibraryLoaderSingleton((VM) vm, createApplicationContextObject((VM) vm));
            recordStubHit("getStaticObjectField", signature, "native-loader-singleton");
            return nativeLibraryLoaderObject;
        }
        if ((DEVICE_ID_FETCHER_CLASS + "->a:Lcom/phonepe/network/base/utils/DeviceIdFetcher;").equals(signature)) {
            if (deviceIdFetcherObject == null) {
                deviceIdFetcherObject = vm.resolveClass(DEVICE_ID_FETCHER_CLASS).newObject("device-id-fetcher");
            }
            recordStubHit("getStaticObjectField", signature, "device-id-fetcher");
            return deviceIdFetcherObject;
        }
        if ((DEVICE_ID_FETCHER_CLASS + "->b:Lcom/phonepe/network/base/utils/DeviceIdContract;").equals(signature)) {
            if (deviceIdContractObject == null) {
                deviceIdContractObject = vm.resolveClass(DEVICE_ID_CONTRACT_CLASS).newObject("device-id-contract");
            }
            recordStubHit("getStaticObjectField", signature, "device-id-contract");
            return deviceIdContractObject;
        }
        if ((SERVER_TIME_OFFSET_CLASS + "->b:Lcom/phonepe/network/base/ServerTimeOffset$Companion;").equals(signature)) {
            if (serverTimeOffsetCompanionObject == null) {
                serverTimeOffsetCompanionObject = vm.resolveClass(SERVER_TIME_OFFSET_COMPANION_CLASS).newObject("server-time-offset-companion");
            }
            recordStubHit("getStaticObjectField", signature, "server-time-offset-companion");
            return serverTimeOffsetCompanionObject;
        }
        if ((SERVER_TIME_OFFSET_CLASS + "->c:Landroid/content/Context;").equals(signature)) {
            DvmObject<?> context = createApplicationContextObject((VM) vm);
            recordStubHit("getStaticObjectField", signature, "app-context");
            return context;
        }
        if ((SERVER_TIME_OFFSET_CLASS + "->d:Lcom/phonepe/network/base/ServerTimeOffset;").equals(signature)) {
            if (serverTimeOffsetObject == null) {
                serverTimeOffsetObject = vm.resolveClass(SERVER_TIME_OFFSET_CLASS).newObject("server-time-offset");
            }
            recordStubHit("getStaticObjectField", signature, "server-time-offset-singleton");
            return serverTimeOffsetObject;
        }
        return super.getStaticObjectField(vm, dvmClass, signature);
    }

    private DvmObject<?> resolveObjectMethod(BaseVM vm, DvmObject<?> dvmObject, String signature, VarArg varArg) {
        if ("java/util/UUID->toString()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, String.valueOf(dvmObject.getValue()));
        }
        if ("android/content/Context->getApplicationContext()Landroid/content/Context;".equals(signature)) {
            return resolveApplicationContextObject((VM) vm, dvmObject);
        }
        if ("android/content/ContextWrapper->getApplicationContext()Landroid/content/Context;".equals(signature)) {
            return resolveApplicationContextObject((VM) vm, dvmObject);
        }
        if ("android/app/Application->getApplicationContext()Landroid/content/Context;".equals(signature)) {
            return resolveApplicationContextObject((VM) vm, dvmObject);
        }
        if ("android/content/Context->getPackageName()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, "com.phonepe.app");
        }
        if ("android/content/ContextWrapper->getPackageName()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, "com.phonepe.app");
        }
        if ("android/app/Application->getPackageName()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, "com.phonepe.app");
        }
        if ("android/content/Context->getPackageCodePath()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, configuredApkPath);
        }
        if ("android/content/ContextWrapper->getPackageCodePath()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, configuredApkPath);
        }
        if ("android/app/Application->getPackageCodePath()Ljava/lang/String;".equals(signature)) {
            return new StringObject(vm, configuredApkPath);
        }
        if ("android/content/Context->getClassLoader()Ljava/lang/ClassLoader;".equals(signature)) {
            return vm.resolveClass("java/lang/ClassLoader").newObject("stub-classloader");
        }
        if ("android/app/Application->getClassLoader()Ljava/lang/ClassLoader;".equals(signature)) {
            return vm.resolveClass("java/lang/ClassLoader").newObject("stub-classloader");
        }
        if ("android/content/Context->getPackageManager()Landroid/content/pm/PackageManager;".equals(signature)) {
            return vm.resolveClass("android/content/pm/PackageManager").newObject("stub-pm");
        }
        if ("android/content/ContextWrapper->getPackageManager()Landroid/content/pm/PackageManager;".equals(signature)) {
            return vm.resolveClass("android/content/pm/PackageManager").newObject("stub-pm");
        }
        if ("android/app/Application->getPackageManager()Landroid/content/pm/PackageManager;".equals(signature)) {
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
        if ((DEVICE_ID_CONTRACT_CLASS + "->generateDeviceIdSync()Ljava/lang/String;").equals(signature)) {
            return new StringObject(vm, configuredDeviceId);
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

    private ChecksumRuntimeSnapshot loadRuntimeSnapshot(String runtimeRoot, Map<String, String> report) {
        if (runtimeRoot == null || runtimeRoot.isBlank()) {
            report.put("probe_runtime_snapshot", "missing-runtime-root");
            return ChecksumRuntimeSnapshot.empty();
        }
        ChecksumRuntimeSnapshot snapshot = ChecksumRuntimeSnapshot.load(Path.of(runtimeRoot));
        report.put("probe_runtime_snapshot", snapshot.hasRuntimeValues() ? "loaded" : "missing");
        if (!snapshot.deviceId().isEmpty()) {
            report.put("probe_runtime_snapshot_device_id", snapshot.deviceId());
        }
        if (snapshot.serverTimeOffsetMs() != null) {
            report.put("probe_runtime_snapshot_offset_ms", Long.toString(snapshot.serverTimeOffsetMs()));
        }
        if (snapshot.adjustedTimeMs() != null) {
            report.put("probe_runtime_snapshot_time_ms", Long.toString(snapshot.adjustedTimeMs()));
        }
        return snapshot;
    }

    private String resolveConfiguredApkPath(String runtimeRoot, Map<String, String> report) {
        String explicitApkPath = readConfigOrNull("probe.target.apk", "PROBE_TARGET_APK");
        if (explicitApkPath != null) {
            report.put("probe_target_apk_source", "explicit");
            return explicitApkPath;
        }
        if (runtimeRoot != null && !runtimeRoot.isBlank()) {
            ChecksumRuntimeManifest manifest = ChecksumRuntimeManifest.load(Path.of(runtimeRoot));
            if (!manifest.sourceApk().isEmpty()) {
                report.put("probe_target_apk_source", "runtime-manifest");
                return manifest.sourceApk();
            }
        }
        report.put("probe_target_apk_source", "fallback-default");
        return "/data/app/com.phonepe.app/base.apk";
    }

    private String resolveConfiguredDeviceId(ChecksumRuntimeSnapshot runtimeSnapshot, Map<String, String> report) {
        String explicitDeviceId = readConfigOrNull("probe.device.id", "PROBE_DEVICE_ID");
        if (explicitDeviceId != null) {
            report.put("probe_device_id_source", "explicit");
            return explicitDeviceId;
        }
        if (!runtimeSnapshot.deviceId().isEmpty()) {
            report.put("probe_device_id_source", "runtime-snapshot");
            return runtimeSnapshot.deviceId();
        }
        report.put("probe_device_id_source", "fallback-stub");
        return "stub-device-id";
    }

    private long resolveConfiguredTimeMs(ChecksumRuntimeSnapshot runtimeSnapshot, Map<String, String> report) {
        String explicitTimeMs = readConfigOrNull("probe.fixed.time.ms", "PROBE_FIXED_TIME_MS");
        if (explicitTimeMs != null) {
            report.put("probe_time_ms_source", "explicit");
            return Long.parseLong(explicitTimeMs);
        }
        if (runtimeSnapshot.serverTimeOffsetMs() != null) {
            report.put("probe_time_ms_source", "runtime-snapshot-offset");
            return System.currentTimeMillis() + runtimeSnapshot.serverTimeOffsetMs();
        }
        if (runtimeSnapshot.adjustedTimeMs() != null) {
            report.put("probe_time_ms_source", "runtime-snapshot-adjusted");
            return runtimeSnapshot.adjustedTimeMs();
        }
        report.put("probe_time_ms_source", "fallback-local-clock");
        return System.currentTimeMillis();
    }

    static long resolveConfiguredTimeMsForTest(ChecksumRuntimeSnapshot runtimeSnapshot) {
        return new UnidbgChecksumProbe().resolveConfiguredTimeMs(runtimeSnapshot, new LinkedHashMap<>());
    }

    private File resolveApkFileForVm(String apkPath, Map<String, String> report) {
        if (apkPath == null || apkPath.isBlank()) {
            report.put("probe_vm_apk_source", "none");
            return null;
        }
        File apkFile = new File(apkPath);
        if (!apkFile.isFile()) {
            report.put("probe_vm_apk_source", "missing:" + apkFile.getAbsolutePath());
            return null;
        }
        report.put("probe_vm_apk_source", apkFile.getAbsolutePath());
        return apkFile;
    }

    static byte[] resolveSignatureBytesForConfig(String runtimeRoot, String apkPath, Map<String, String> report) {
        if (runtimeRoot != null && !runtimeRoot.isBlank()) {
            Path runtimeSignature = ChecksumRuntimePaths.runtimeSignature(Path.of(runtimeRoot));
            if (Files.isRegularFile(runtimeSignature)) {
                try {
                    byte[] bytes = Files.readAllBytes(runtimeSignature);
                    report.put("probe_signature_source", "runtime-signature");
                    report.put("probe_signature_length", Integer.toString(bytes.length));
                    return bytes;
                } catch (IOException e) {
                    report.put("probe_signature_source", "runtime-signature-failed:" + sanitize(e));
                }
            }
        }
        return resolveSignatureBytes(apkPath, report);
    }

    private static byte[] resolveSignatureBytes(String apkPath, Map<String, String> report) {
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
        DvmObject<?> originalStatic = resolveOriginalStaticObjectMethod((VM) vm, signature, firstArg);
        if (originalStatic != null) {
            return originalStatic;
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
        DvmObject<?> originalStatic = resolveOriginalStaticObjectMethod((VM) vm, signature, firstArg);
        if (originalStatic != null) {
            return originalStatic;
        }
        DvmObject<?> chFallback = resolveChStaticByteArrayFallback(vm, signature, firstArg, secondArg);
        if (chFallback != null) {
            return chFallback;
        }
        return super.callStaticObjectMethodV(vm, dvmClass, signature, vaList);
    }

    @Override
    public void callVoidMethod(BaseVM vm, DvmObject<?> dvmObject, String signature, VarArg varArg) {
        if ((NATIVE_LIBRARY_LOADER_CLASS + "->" + LOAD_LIBRARY_SIG).equals(signature)) {
            ensureNativeLibraryLoaderSingleton((VM) vm, createApplicationContextObject((VM) vm));
            recordStubHit("callVoidMethod", signature, "native-loader-load");
            return;
        }
        super.callVoidMethod(vm, dvmObject, signature, varArg);
    }

    @Override
    public void callVoidMethodV(BaseVM vm, DvmObject<?> dvmObject, String signature, VaList vaList) {
        if ((NATIVE_LIBRARY_LOADER_CLASS + "->" + LOAD_LIBRARY_SIG).equals(signature)) {
            ensureNativeLibraryLoaderSingleton((VM) vm, createApplicationContextObject((VM) vm));
            recordStubHit("callVoidMethod", signature, "native-loader-load");
            return;
        }
        super.callVoidMethodV(vm, dvmObject, signature, vaList);
    }

    @Override
    public void callStaticVoidMethodV(BaseVM vm, DvmClass dvmClass, String signature, VaList vaList) {
        if (signature.startsWith("com/phonepe/networkclient/utils/CH->")) {
            recordChFallback(signature, "void");
            return;
        }
        super.callStaticVoidMethodV(vm, dvmClass, signature, vaList);
    }

    @Override
    public long callLongMethod(BaseVM vm, DvmObject<?> dvmObject, String signature, VarArg varArg) {
        if ((SERVER_TIME_OFFSET_CLASS + "->a()J").equals(signature)) {
            recordStubHit("callLongMethod", signature, Long.toString(configuredTimeMs));
            return configuredTimeMs;
        }
        return super.callLongMethod(vm, dvmObject, signature, varArg);
    }

    private DvmObject<?> resolveOriginalStaticObjectMethod(VM vm, String signature, DvmObject<?> firstArg) {
        if ((NATIVE_LIBRARY_LOADER_COMPANION_CLASS + "->a(Landroid/content/Context;)Lcom/phonepe/util/NativeLibraryLoader;").equals(signature)) {
            DvmObject<?> appContext = resolveApplicationContextObject(vm, firstArg);
            ensureNativeLibraryLoaderSingleton(vm, appContext);
            recordStubHit("callStaticObjectMethod", signature, "native-loader-singleton");
            return nativeLibraryLoaderObject;
        }
        if ((SERVER_TIME_OFFSET_COMPANION_CLASS + "->b()Lcom/phonepe/network/base/ServerTimeOffset;").equals(signature)) {
            if (serverTimeOffsetObject == null) {
                serverTimeOffsetObject = vm.resolveClass(SERVER_TIME_OFFSET_CLASS).newObject("server-time-offset");
            }
            recordStubHit("callStaticObjectMethod", signature, "server-time-offset-singleton");
            return serverTimeOffsetObject;
        }
        if ((SERVER_TIME_OFFSET_COMPANION_CLASS + "->a()Landroid/content/Context;").equals(signature)) {
            DvmObject<?> appContext = createApplicationContextObject(vm);
            recordStubHit("callStaticObjectMethod", signature, "app-context");
            return appContext;
        }
        return null;
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
        String value = readConfigOrNull(propertyKey, envKey);
        if (value != null) {
            return value;
        }
        return defaultValue;
    }

    private static String readConfigOrNull(String propertyKey, String envKey) {
        String value = System.getProperty(propertyKey);
        if (value != null && !value.isEmpty()) {
            return value;
        }
        value = System.getenv(envKey);
        if (value != null && !value.isEmpty()) {
            return value;
        }
        return null;
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
