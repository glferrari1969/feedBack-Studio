from __future__ import annotations

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

try:
    from cryptography.hazmat.decrepit.ciphers import modes as decrepit_modes
    CFB_MODE = decrepit_modes.CFB
except ImportError:
    CFB_MODE = modes.CFB


def aes_cfb128_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    decryptor = Cipher(algorithms.AES(key), CFB_MODE(iv)).decryptor()
    return decryptor.update(data) + decryptor.finalize()


def aes_cfb128_encrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    encryptor = Cipher(algorithms.AES(key), CFB_MODE(iv)).encryptor()
    return encryptor.update(data) + encryptor.finalize()


def aes_ctr_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    decryptor = Cipher(algorithms.AES(key), modes.CTR(iv)).decryptor()
    return decryptor.update(data) + decryptor.finalize()
