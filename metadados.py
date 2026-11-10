"""Metadados dos arquivos de mídia, lidos direto dos bytes (sem bibliotecas externas).

Fotos JPEG: dimensões e EXIF (câmera, data da foto, GPS), quando o arquivo ainda o tem.
Áudios Ogg Opus: canais, taxa de amostragem e duração.
Qualquer arquivo: formato real (pela assinatura), tamanho, datas do arquivo e SHA-256.
"""
import hashlib
import struct
from datetime import datetime
from pathlib import Path


def milhar(n):
    return f"{n:,}".replace(",", ".")


def tamanho_legivel(n):
    if n < 1024:
        return f"{n} bytes"
    for unidade in ("KB", "MB", "GB"):
        n /= 1024
        if n < 1024 or unidade == "GB":
            return f"{n:.1f} {unidade}".replace(".", ",")


def formato_real(dados):
    if dados[:3] == b"\xff\xd8\xff":
        return "JPEG"
    if dados[:8] == b"\x89PNG\r\n\x1a\n":
        return "PNG"
    if dados[:4] == b"OggS":
        return "Ogg Opus" if b"OpusHead" in dados[:64] else "Ogg"
    if dados[4:8] == b"ftyp":
        return "MP4/M4A"
    if dados[:2] in (b"\xff\xf1", b"\xff\xf9"):
        return "AAC (ADTS)"
    if dados[:4] == b"RIFF" and dados[8:12] == b"WEBP":
        return "WebP"
    return "desconhecido"


# ---------- JPEG ----------

TAGS_EXIF = {
    0x010F: "Fabricante",
    0x0110: "Modelo",
    0x0131: "Software",
    0x0132: "Data de modificação (EXIF)",
    0x9003: "Data da foto (EXIF)",
    0x9004: "Data de digitalização (EXIF)",
    0x0112: "Orientação",
}


def _ler_ifd(tiff, inicio, ordem):
    """Lê uma tabela de tags EXIF; devolve {tag: valor}."""
    entradas = {}
    if inicio + 2 > len(tiff):
        return entradas
    (n,) = struct.unpack(ordem + "H", tiff[inicio:inicio + 2])
    tamanhos = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8}
    for i in range(n):
        p = inicio + 2 + i * 12
        if p + 12 > len(tiff):
            break
        tag, tipo, qtd = struct.unpack(ordem + "HHI", tiff[p:p + 8])
        largura = tamanhos.get(tipo, 1) * qtd
        if largura <= 4:
            bruto = tiff[p + 8:p + 8 + largura]
        else:
            (desloc,) = struct.unpack(ordem + "I", tiff[p + 8:p + 12])
            bruto = tiff[desloc:desloc + largura]
        if tipo == 2:
            valor = bruto.split(b"\0", 1)[0].decode("utf-8", "replace").strip()
        elif tipo == 3:
            valor = struct.unpack(ordem + "H" * qtd, bruto[:2 * qtd]) if len(bruto) >= 2 * qtd else ()
            valor = valor[0] if qtd == 1 and valor else valor
        elif tipo == 4:
            valor = struct.unpack(ordem + "I" * qtd, bruto[:4 * qtd]) if len(bruto) >= 4 * qtd else ()
            valor = valor[0] if qtd == 1 and valor else valor
        elif tipo in (5, 10):
            fmt = "I" if tipo == 5 else "i"
            nums = struct.unpack(ordem + fmt * 2 * qtd, bruto[:8 * qtd]) if len(bruto) >= 8 * qtd else ()
            valor = tuple(nums[k] / nums[k + 1] if nums[k + 1] else 0 for k in range(0, len(nums), 2))
        else:
            valor = bruto
        entradas[tag] = valor
    return entradas


def _graus(valor, ref):
    if not isinstance(valor, tuple) or len(valor) != 3:
        return None
    g = valor[0] + valor[1] / 60 + valor[2] / 3600
    return -g if ref in ("S", "W") else g


def _exif(tiff):
    ordem = "<" if tiff[:2] == b"II" else ">"
    (ifd0,) = struct.unpack(ordem + "I", tiff[4:8])
    tags = _ler_ifd(tiff, ifd0, ordem)
    if 0x8769 in tags:
        tags.update(_ler_ifd(tiff, tags[0x8769], ordem))
    saida = {nome: tags[t] for t, nome in TAGS_EXIF.items() if t in tags and tags[t] not in ("", ())}
    if 0x8825 in tags:
        gps = _ler_ifd(tiff, tags[0x8825], ordem)
        lat = _graus(gps.get(2), gps.get(1))
        lon = _graus(gps.get(4), gps.get(3))
        if lat is not None and lon is not None:
            saida["GPS"] = f"{lat:.6f}, {lon:.6f}"
            saida["_gps"] = [lat, lon]
    return saida


def ler_jpeg(dados):
    info = {}
    i = 2
    while i + 4 <= len(dados) and dados[i] == 0xFF:
        marcador = dados[i + 1]
        (comp,) = struct.unpack(">H", dados[i + 2:i + 4])
        bloco = dados[i + 4:i + 2 + comp]
        if marcador == 0xE1 and bloco[:6] == b"Exif\0\0":
            try:
                info["exif"] = _exif(bloco[6:])
            except (struct.error, IndexError, ValueError):
                info["exif"] = {}
        elif marcador in (0xC0, 0xC1, 0xC2) and len(bloco) >= 5:
            altura, largura = struct.unpack(">HH", bloco[1:5])
            info["Dimensões"] = f"{largura} × {altura} px"
            info["Megapixels"] = f"{largura * altura / 1e6:.2f}".replace(".", ",")
        elif marcador == 0xDA:
            break
        i += 2 + comp
    return info


def ler_png(dados):
    largura, altura = struct.unpack(">II", dados[16:24])
    return {"Dimensões": f"{largura} × {altura} px", "Megapixels": f"{largura * altura / 1e6:.2f}".replace(".", ",")}


# ---------- Ogg Opus ----------

def ler_opus(dados):
    info = {}
    p = dados.find(b"OpusHead")
    if p < 0:
        return info
    canais = dados[p + 9]
    (pre_skip,) = struct.unpack("<H", dados[p + 10:p + 12])
    (taxa_original,) = struct.unpack("<I", dados[p + 12:p + 16])
    info["Canais"] = "mono" if canais == 1 else "estéreo" if canais == 2 else str(canais)
    if taxa_original:
        info["Taxa de amostragem original"] = f"{milhar(taxa_original)} Hz"
    # A duração sai da posição (granule) da última página Ogg, sempre em 48 kHz
    ultima = dados.rfind(b"OggS")
    if ultima >= 0 and ultima + 14 <= len(dados):
        (granulo,) = struct.unpack("<q", dados[ultima + 6:ultima + 14])
        segundos = max(0, granulo - pre_skip) / 48000
        info["Duração (arquivo)"] = f"{int(segundos // 60)}:{segundos % 60:04.1f}".replace(".", ",")
        if segundos:
            info["Taxa de bits média"] = f"{len(dados) * 8 / segundos / 1000:.1f} kbit/s".replace(".", ",")
    p_tags = dados.find(b"OpusTags")
    if p_tags >= 0:
        (n,) = struct.unpack("<I", dados[p_tags + 8:p_tags + 12])
        info["Codificador"] = dados[p_tags + 12:p_tags + 12 + n].decode("utf-8", "replace")
    return info


# ---------- Geral ----------

def ler_arquivo(caminho: Path):
    dados = caminho.read_bytes()
    estado = caminho.stat()
    real = formato_real(dados)
    extensao = caminho.suffix.lower().lstrip(".")
    info = {
        "Arquivo": caminho.name,
        "Pasta no backup": str(caminho.parent.name),
        "Formato real": real + ("" if extensao in real.lower() or (extensao == "jpg" and real == "JPEG")
                                else f" (a extensão diz .{extensao})"),
        "Tamanho": f"{tamanho_legivel(len(dados))} ({milhar(len(dados))} bytes)",
        "Data do arquivo no backup": datetime.fromtimestamp(estado.st_mtime).strftime("%d/%m/%Y %H:%M:%S"),
    }
    exif = None  # None: o arquivo não tem EXIF; {}: tem, mas sem câmera, data nem GPS
    if real == "JPEG":
        jpeg = ler_jpeg(dados)
        exif = jpeg.pop("exif", None)
        info.update(jpeg)
    elif real == "PNG":
        info.update(ler_png(dados))
    elif real == "Ogg Opus":
        info.update(ler_opus(dados))
    info["SHA-256"] = hashlib.sha256(dados).hexdigest()
    info["MD5"] = hashlib.md5(dados).hexdigest()
    return info, exif
