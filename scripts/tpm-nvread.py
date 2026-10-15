#!/usr/bin/env python3
"""Read Azure's HCL attestation report out of the vTPM, with no tpm2-tools.

The CVM has libtss2 but none of the tpm2_* binaries, and it cannot install them: the NSG denies
everything but four Azure service tags, which is correct and worth keeping. /dev/tpmrm0 is the kernel's
TPM resource manager, so raw TPM2 commands can be written to it directly — NV_ReadPublic for the size,
then NV_Read in chunks under a password session on the owner hierarchy (an empty password, which is how
Azure provisions this index: `tpm2_nvread -C o 0x01400001`).
"""
import struct, sys

TPM = '/dev/tpmrm0'
ST_NO_SESSIONS, ST_SESSIONS = 0x8001, 0x8002
CC_NV_READ, CC_NV_READPUBLIC = 0x0000014E, 0x00000169
RH_OWNER, RS_PW = 0x40000001, 0x40000009
INDEX = int(sys.argv[1], 16) if len(sys.argv) > 1 else 0x01400001

def transmit(cmd: bytes) -> bytes:
    with open(TPM, 'r+b', buffering=0) as f:
        f.write(cmd)
        return f.read(8192)

def check(resp: bytes) -> bytes:
    tag, size, rc = struct.unpack('>HII', resp[:10])
    if rc != 0:
        raise SystemExit(f'TPM error rc=0x{rc:08x}')
    return resp[10:size]

def nv_public(index: int):
    body = struct.pack('>I', index)
    cmd = struct.pack('>HII', ST_NO_SESSIONS, 10 + len(body), CC_NV_READPUBLIC) + body
    p = check(transmit(cmd))
    # TPM2B_NV_PUBLIC: size(2) then TPMS_NV_PUBLIC { nvIndex(4) nameAlg(2) attrs(4) authPolicy(2+n) dataSize(2) }
    (pub_size,) = struct.unpack('>H', p[:2])
    pub = p[2:2 + pub_size]
    (policy_len,) = struct.unpack('>H', pub[10:12])
    (data_size,) = struct.unpack('>H', pub[12 + policy_len:14 + policy_len])
    return data_size

def nv_read(index: int, size: int, offset: int) -> bytes:
    auth = struct.pack('>IHBH', RS_PW, 0, 0, 0)          # password session, no nonce, no hmac
    body = struct.pack('>II', RH_OWNER, index) + struct.pack('>I', len(auth)) + auth + struct.pack('>HH', size, offset)
    cmd = struct.pack('>HII', ST_SESSIONS, 10 + len(body), CC_NV_READ) + body
    p = check(transmit(cmd))
    p = p[4:]                                            # sessions tag ⇒ leading parameterSize
    (n,) = struct.unpack('>H', p[:2])
    return p[2:2 + n]

total = nv_public(INDEX)
out, off, CHUNK = b'', 0, 512                            # the TPM refuses a read larger than its buffer
while off < total:
    want = min(CHUNK, total - off)
    out += nv_read(INDEX, want, off)
    off += want
sys.stdout.buffer.write(out)
