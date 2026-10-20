"""Verify pinned offline OCR inputs and uncompressed 16 KiB-aligned APK JNI files.

No network calls. Import verify_vendor()/verify_apk() from the build pipeline, or:
  python verify_vendor.py --apk PATH --json REPORT
The JSON report contains public dependency hashes and alignment metadata only.
"""
from pathlib import Path
import argparse
import hashlib
import json
import struct
import zipfile

VENDOR = Path(__file__).resolve().parent
ABIS = ('arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64')
LIBRARIES = ('libjpeg.so', 'libleptonica.so', 'libpngx.so', 'libtesseract.so')
PAGE_BYTES = 16384


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def elf_loads(data, abi):
    """Check PT_LOAD alignment, including file/virtual-address congruence."""
    require(data[:4] == b'\x7fELF' and len(data) >= 64, 'JNI library is not ELF')
    elf_class, encoding = data[4], data[5]
    require(encoding in (1, 2) and elf_class in (1, 2), 'Unsupported ELF encoding')
    byte_order = '<' if encoding == 1 else '>'
    expected_class = 2 if abi in ('arm64-v8a', 'x86_64') else 1
    require(elf_class == expected_class, 'ELF class does not match ABI: ' + abi)
    if elf_class == 2:
        phoff = struct.unpack_from(byte_order + 'Q', data, 32)[0]
        phentsize, phnum = struct.unpack_from(byte_order + 'HH', data, 54)
        fmt = byte_order + 'IIQQQQQQ'
    else:
        phoff = struct.unpack_from(byte_order + 'I', data, 28)[0]
        phentsize, phnum = struct.unpack_from(byte_order + 'HH', data, 42)
        fmt = byte_order + 'IIIIIIII'
    require(phentsize >= struct.calcsize(fmt) and phnum > 0 and phoff + phentsize * phnum <= len(data), 'Invalid ELF program-header table')
    loads = []
    required = PAGE_BYTES if elf_class == 2 else 4096
    for index in range(phnum):
        row = struct.unpack_from(fmt, data, phoff + index * phentsize)
        if row[0] != 1:
            continue
        if elf_class == 2:
            offset, vaddr, filesz, memsz, alignment = row[2], row[3], row[5], row[6], row[7]
        else:
            offset, vaddr, filesz, memsz, alignment = row[1], row[2], row[4], row[5], row[7]
        require(alignment >= required and alignment & (alignment - 1) == 0, 'ELF PT_LOAD alignment is insufficient for ' + abi)
        require(offset % required == vaddr % required, 'ELF PT_LOAD offset/address mismatch for ' + abi)
        require(memsz >= filesz and offset + filesz <= len(data), 'Invalid ELF load-segment bounds')
        loads.append({'offset': offset, 'virtualAddress': vaddr, 'alignment': alignment})
    require(loads, 'ELF has no PT_LOAD segments')
    return {'elfBits': 64 if elf_class == 2 else 32, 'requiredPageBytes': required,
            'minimumLoadAlignment': min(row['alignment'] for row in loads), 'loadSegments': loads}


def license_inputs(vendor):
    lock = json.loads((vendor / 'licenses.lock.json').read_text(encoding='utf-8'))
    require(lock.get('version') == 1 and len(lock.get('licenses', [])) == 6, 'Invalid OCR license lock')
    result = []
    for entry in lock['licenses']:
        filename = entry['file']
        require(Path(filename).name == filename and filename.endswith('.txt'), 'Unsafe license filename')
        file = vendor / 'licenses' / filename
        require(file.is_file(), 'Missing OCR license: ' + filename)
        digest = sha256(file.read_bytes())
        require(digest == entry['sha256'], 'OCR license hash mismatch: ' + filename)
        result.append({'file': filename, 'component': entry['component'], 'license': entry['license'], 'sha256': digest})
    notice = vendor / 'licenses' / 'THIRD-PARTY-NOTICES.txt'
    require(notice.is_file(), 'Missing OCR third-party attribution notice')
    result.append({'file': notice.name, 'component': 'Suike OCR attribution notices', 'sha256': sha256(notice.read_bytes())})
    return result


def verify_vendor(vendor=VENDOR):
    vendor = Path(vendor)
    lock = json.loads((vendor / 'lock.json').read_text(encoding='utf-8'))
    version = lock['tesseract4android']['version']
    aar = vendor / ('tesseract4android-' + version + '.aar')
    model = vendor / 'chi_sim.traineddata'
    require(aar.is_file() and model.is_file(), 'Offline OCR input missing; run product/vendor/fetch_vendor.py')
    aar_hash, model_hash = sha256(aar.read_bytes()), sha256(model.read_bytes())
    require(aar_hash == lock['tesseract4android']['sha256'], 'Tesseract4Android AAR hash mismatch')
    require(model_hash == lock['chi_sim']['sha256'], 'Chinese OCR model hash mismatch')
    expected = {'jni/' + abi + '/' + name for abi in ABIS for name in LIBRARIES}
    native = []
    with zipfile.ZipFile(aar) as archive:
        require(archive.testzip() is None, 'Corrupt OCR AAR')
        require(len(archive.namelist()) == len(set(archive.namelist())), 'Duplicate AAR entries')
        actual = {name for name in archive.namelist() if name.startswith('jni/') and name.endswith('.so')}
        require(actual == expected, 'Unexpected OCR JNI ABI/library set')
        jar = archive.read('classes.jar')
        require((vendor / 'classes.jar').is_file() and (vendor / 'classes.jar').read_bytes() == jar, 'classes.jar differs from pinned AAR')
        for filename in sorted(actual):
            abi = filename.split('/')[1]
            data = archive.read(filename)
            native.append({'aarEntry': filename, 'apkEntry': 'lib/' + filename[4:], 'abi': abi, 'sha256': sha256(data), 'size': len(data), **elf_loads(data, abi)})
    return {'version': version, 'aarSha256': aar_hash, 'classesJarSha256': sha256(jar),
            'model': {'language': 'chi_sim', 'commit': lock['chi_sim']['commit'], 'sha256': model_hash, 'size': model.stat().st_size},
            'abis': list(ABIS), 'nativeLibraries': native, 'licenses': license_inputs(vendor),
            'elf64Page16KCompatible': True, 'deviceTested': False}


def zip_data_offset(file, entry):
    file.seek(entry.header_offset)
    header = file.read(30)
    require(len(header) == 30 and header[:4] == b'PK\x03\x04', 'Invalid ZIP local header')
    filename_length, extra_length = struct.unpack_from('<HH', header, 26)
    return entry.header_offset + 30 + filename_length + extra_length


def verify_apk(apk, vendor=VENDOR, vendor_report=None):
    apk, vendor = Path(apk), Path(vendor)
    report = vendor_report if vendor_report is not None else verify_vendor(vendor)
    native = []
    with zipfile.ZipFile(apk) as archive, apk.open('rb') as stream:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'Duplicate APK ZIP entries')
        require(archive.testzip() is None, 'Corrupt APK ZIP entries')
        expected = {entry['apkEntry'] for entry in report['nativeLibraries']}
        actual = {name for name in names if name.startswith('lib/') and name.endswith('.so')}
        require(actual == expected, 'APK OCR JNI ABI/library set differs from pinned AAR')
        for source in report['nativeLibraries']:
            entry = archive.getinfo(source['apkEntry'])
            require(entry.compress_type == zipfile.ZIP_STORED, 'JNI library must be ZIP_STORED: ' + entry.filename)
            offset = zip_data_offset(stream, entry)
            require(offset % PAGE_BYTES == 0, 'JNI library is not 16 KiB ZIP aligned: ' + entry.filename)
            require(sha256(archive.read(entry)) == source['sha256'], 'Packaged JNI library hash mismatch: ' + entry.filename)
            native.append({'entry': entry.filename, 'dataOffset': offset, 'zipStored': True, 'zipPageBytes': PAGE_BYTES, 'minimumLoadAlignment': source['minimumLoadAlignment']})
        model_entry = 'assets/ocr/chi_sim.traineddata'
        require(model_entry in names and sha256(archive.read(model_entry)) == report['model']['sha256'], 'APK Chinese OCR model missing or altered')
        for license in report['licenses']:
            entry = 'assets/licenses/ocr/' + license['file']
            require(entry in names and sha256(archive.read(entry)) == license['sha256'], 'APK OCR license missing or altered: ' + entry)
        dex_names = [name for name in names if name.startswith('classes') and name.endswith('.dex')]
        require(dex_names and any(b'Lcom/googlecode/tesseract/android/TessBaseAPI;' in archive.read(name) for name in dex_names), 'Tesseract classes were not compiled into APK DEX')
    return {'apk': apk.name, 'sha256': sha256(apk.read_bytes()), 'size': apk.stat().st_size,
            'nativeLibraryCount': len(native), 'nativeLibraries': native, 'zipPage16KAligned': True,
            'elf64Page16KCompatible': True, 'modelSha256': report['model']['sha256'],
            'licenseCount': len(report['licenses']), 'dexFiles': sorted(dex_names), 'deviceTested': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path)
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    result = {'vendor': verify_vendor()}
    if args.apk:
        result['apk'] = verify_apk(args.apk, vendor_report=result['vendor'])
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(encoded, encoding='utf-8')
    print(encoded)


if __name__ == '__main__':
    main()
