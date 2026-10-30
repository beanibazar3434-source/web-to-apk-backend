FROM eclipse-temurin:17-jdk
RUN apt-get update && apt-get install -y curl unzip ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
ENV ANDROID_HOME=/opt/android
RUN mkdir -p $ANDROID_HOME/cmdline-tools && cd /tmp \
 && curl -fsSL -o t.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
 && unzip -q t.zip && mv cmdline-tools $ANDROID_HOME/cmdline-tools/latest && rm t.zip
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
RUN yes | sdkmanager --licenses >/dev/null 2>&1; sdkmanager "platforms;android-34" "build-tools;34.0.0"
RUN curl -fsSL -o /tmp/g.zip https://services.gradle.org/distributions/gradle-8.5-bin.zip \
 && unzip -q /tmp/g.zip -d /opt && rm /tmp/g.zip
ENV PATH=$PATH:/opt/gradle-8.5/bin
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.js .
ENV PORT=3000
EXPOSE 3000
CMD ["node","server.js"]
