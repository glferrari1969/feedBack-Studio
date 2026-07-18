from __future__ import annotations

import enum
import zlib
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

WIN_KEY = bytes.fromhex("CB648DF3D12A16BF71701414E69619EC171CCA5D2A142E3E59DE7ADDA18A3A30")
MAC_KEY = bytes.fromhex("9821330E34B91F70D0A48CBD625993126970CEA09192C0E6CDA676CC9838289D")

class Platform(str, enum.Enum):
    PC = "pc"
    MAC = "mac"


def _key(platform: Platform | str) -> bytes:
    p = Platform(platform.lower()) if isinstance(platform, str) else platform
    return WIN_KEY if p == Platform.PC else MAC_KEY


def is_packed_sng(data: bytes) -> bool:
    return len(data) >= 24 and int.from_bytes(data[:4], "little") == 0x4A


def decrypt_sng(data: bytes, platform: Platform | str = Platform.PC) -> bytes:
    """Return the plain/decompressed SNG payload.

    Rocksmith 2014 SNG files are usually packed as:
    uint32 magic 0x4a, uint32 version/header, 16-byte IV, AES-CTR(zlib(uint32 length + payload)).
    If data does not look packed, it is returned unchanged.
    """
    if not is_packed_sng(data):
        return data
    iv = data[8:24]
    encrypted = data[24:]
    decryptor = Cipher(algorithms.AES(_key(platform)), modes.CTR(iv)).decryptor()
    packed = decryptor.update(encrypted) + decryptor.finalize()
    if len(packed) < 4:
        raise ValueError("SNG decifrato troppo corto")
    expected = int.from_bytes(packed[:4], "little")
    # Some packed files contain trailing encrypted padding; zlib stops at the end of stream.
    payload = zlib.decompress(packed[4:])
    if expected and len(payload) != expected:
        raise ValueError(f"Dimensione SNG non coerente: attesi {expected}, ottenuti {len(payload)}")
    return payload
