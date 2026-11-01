const fs = require("node:fs");
const path = "android/app/build.gradle";
const source = fs.readFileSync(path, "utf8");
const signing = `
    signingConfigs {
        release {
            storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }
    }
`;
if (!process.env.ANDROID_KEYSTORE_PATH)
  throw Error("Missing external Android signing credentials");
fs.writeFileSync(
  path,
  source
    .replace("android {", "android {" + signing)
    .replace(
      /signingConfig signingConfigs.debug/g,
      "signingConfig signingConfigs.release",
    ),
);
