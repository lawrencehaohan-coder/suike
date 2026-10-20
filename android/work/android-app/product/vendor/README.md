Offline OCR build inputs
========================

`lock.json` pins the Tesseract4Android 4.9.0 AAR and `tessdata_fast` simplified
Chinese model by HTTPS URL and SHA-256. `classes.jar` must be byte-for-byte the
file inside that AAR. `licenses.lock.json` pins the six original upstream license
files. No network access happens during the APK build.

The AAR itself contains no license text. The `licenses/` directory supplies the
licenses from Tesseract4Android's exact 4.9.0 commit and the model's exact commit,
plus `THIRD-PARTY-NOTICES.txt` with component attribution and the required IJG
acknowledgement. Include all seven files in `assets/licenses/ocr/`, including in
binary redistributions. Do not describe this directory as a single Apache-only
dependency: Leptonica, libpng and IJG retain their respective terms.

Commands (run from the workspace or any directory):

```powershell
python work/android-app/product/vendor/fetch_vendor.py
python work/android-app/product/vendor/fetch_vendor.py --verify-only
python work/android-app/product/vendor/verify_vendor.py --apk outputs/随课_安卓离线版.apk --json work/android-app/build/ocr-verification.json
python work/android-app/build.py --compile-only
python work/android-app/build.py --unsigned-only
```

`fetch_vendor.py` downloads only missing inputs and verifies every file before
installing it. An existing file with an unexpected hash stops the script, rather
than being replaced. A missing `classes.jar` is extracted only from the verified
AAR. Licensing notices authored here are part of the source package.

`verify_vendor.verify_vendor()` returns the AAR/model/JAR/license hashes and the
four ABI library inventories, including ELF PT_LOAD segment checks.
`verify_vendor.verify_apk(path, vendor_report=report)` returns the APK hash, native
library offsets, DEX names, model hash and license count. It rejects missing or
altered files, compressed JNI libraries, or native file offsets not divisible by
16384. It also verifies the TessBaseAPI class descriptor exists in compiled DEX.

The 64-bit libraries (`arm64-v8a`, `x86_64`) have 16384-byte ELF load alignment;
the supplied 32-bit libraries retain 4096-byte ELF load alignment. All sixteen
libraries are stored without ZIP compression and aligned to 16 KiB in the APK.
This verifies packaging and 64-bit ELF compatibility. It is not an Android
device test, OCR accuracy test, or a claim that every native library is a
64-bit binary.
