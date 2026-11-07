"""Fetch the pinned offline English -> Persian model (Python 3 standard library).

The app can also download it itself (Persian Subtitles -> Download model).
"""
import hashlib
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
CDN = "https://firefox-settings-attachments.cdn.mozilla.net/main-workspace/translations-models/"
FILES = [
    ("model.enfa.intgemm.alphas.bin", "8e412aee-68b4-46cd-aa00-1e7357db24c1.bin", "456ad3952bcc59d208c76baba4dcef340ee4239416bd760d6fec27f9a16228f8"),
    ("vocab.enfa.spm", "203a10f4-6885-49c2-89e3-e7a4f3e3e738.spm", "6435d3d9d766159fe192ab90892540b438ad7adb7ab4ea4049f68d0b4cdea3bd"),
    ("lex.50.50.enfa.s2t.bin", "8ec72d9b-f5b6-40bd-a23d-cedb2c757e92.bin", "8542e7fb2bfa3a11b89f8392b8adb0dbbf863cd34569488b7c4535a91c3ae6b4"),
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


if __name__ == "__main__":
    folder = ROOT / "models" / "enfa"
    folder.mkdir(parents=True, exist_ok=True)
    for name, attachment, sha in FILES:
        target = folder / name
        if target.exists() and digest(target.read_bytes()) == sha:
            print("Verified:", name, flush=True)
            continue
        with urllib.request.urlopen(CDN + attachment, timeout=120) as response:
            data = response.read()
        if digest(data) != sha:
            raise RuntimeError(f"Checksum mismatch for {name}; please retry.")
        target.write_bytes(data)
        print("Downloaded:", name, len(data) // 1000, "kB", flush=True)
    print("Offline Persian model ready in", folder, flush=True)
