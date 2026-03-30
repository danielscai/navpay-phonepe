package com.httpinterceptor.interceptor;

final class DeviceSnapshot {

    final String androidId;
    final String deviceName;
    final String brand;
    final String model;
    final String osVersion;
    final int sdkInt;
    final String timezone;
    final String locale;

    DeviceSnapshot(
        String androidId,
        String deviceName,
        String brand,
        String model,
        String osVersion,
        int sdkInt,
        String timezone,
        String locale
    ) {
        this.androidId = androidId;
        this.deviceName = deviceName;
        this.brand = brand;
        this.model = model;
        this.osVersion = osVersion;
        this.sdkInt = sdkInt;
        this.timezone = timezone;
        this.locale = locale;
    }
}
