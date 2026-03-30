FROM maven:3.9.9-eclipse-temurin-11 AS build

WORKDIR /workspace

COPY src/services/checksum/pom.xml src/services/checksum/pom.xml
COPY src/services/checksum/src src/services/checksum/src

RUN mvn -f src/services/checksum/pom.xml -q -DskipTests package

FROM eclipse-temurin:11-jre

WORKDIR /app

ENV CHECKSUM_HTTP_HOST=0.0.0.0
ENV CHECKSUM_HTTP_PORT=19190
ENV PROBE_RUNTIME_ROOT=/app/runtime

COPY --from=build /workspace/src/services/checksum/target/checksum-service.jar /app/checksum-service.jar
COPY src/services/checksum/runtime /app/runtime

EXPOSE 19190

ENTRYPOINT ["java", "-jar", "/app/checksum-service.jar"]
