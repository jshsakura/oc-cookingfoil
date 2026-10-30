/*
 * chdtrack: prints "<crc32 hex> <size>" of the first track of a CHD disc image, the way Redump lists a
 * disc's first track (its sectors without subcode). A DVD image, which has no track list, is hashed whole;
 * a GD-ROM or any other kind of image is not hashed.
 * Reads the image through libchdr (BSD-3-Clause) and writes nothing to disk. Exit 1 when it cannot.
 */
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <libchdr/chd.h>

static uint32_t crc_table[256];

static void crc_init(void) {
  for (uint32_t i = 0; i < 256; i++) {
    uint32_t c = i;
    for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
    crc_table[i] = c;
  }
}

static uint32_t crc_update(uint32_t crc, const uint8_t *p, size_t n) {
  crc = ~crc;
  while (n--) crc = crc_table[(crc ^ *p++) & 0xFF] ^ (crc >> 8);
  return ~crc;
}

#define FRAME 2448 /* a CD frame in a CHD: 2352 bytes of sector and 96 of subcode */

/* Bytes of sector data a track type keeps per frame, as chdman extractcd writes them. */
static uint32_t sector_bytes(const char *type) {
  if (!strcmp(type, "MODE1") || !strcmp(type, "MODE2_FORM1")) return 2048;
  if (!strcmp(type, "MODE2_FORM2")) return 2324;
  if (!strcmp(type, "MODE2") || !strcmp(type, "MODE2_FORM_MIX")) return 2336;
  return 2352;
}

int main(int argc, char **argv) {
  if (argc != 2) return 1;
  chd_file *chd = NULL;
  if (chd_open(argv[1], CHD_OPEN_READ, NULL, &chd) != CHDERR_NONE) return 1;
  const chd_header *h = chd_get_header(chd);
  uint32_t hunk_bytes = h->hunkbytes;
  uint8_t *buf = malloc(hunk_bytes);
  if (!buf) return 1;

  char meta[256];
  uint32_t len = 0;
  uint64_t want; /* bytes to hash */
  uint32_t frames = 0;
  uint32_t keep = 0;
  /* CHT2 and the older CHTR hold the same track line; only a DVD tag means "the whole image is the disc". */
  int cd = chd_get_metadata(chd, CDROM_TRACK_METADATA2_TAG, 0, meta, sizeof meta - 1, &len, NULL, NULL) == CHDERR_NONE
        || chd_get_metadata(chd, CDROM_TRACK_METADATA_TAG, 0, meta, sizeof meta - 1, &len, NULL, NULL) == CHDERR_NONE;
  if (cd) {
    char type[32] = "";
    meta[len] = 0;
    if (sscanf(meta, "TRACK:%*u TYPE:%31s SUBTYPE:%*s FRAMES:%u", type, &frames) != 2) return 1;
    keep = sector_bytes(type);
    want = (uint64_t)frames * keep;
  } else if (chd_get_metadata(chd, DVD_METADATA_TAG, 0, meta, sizeof meta - 1, &len, NULL, NULL) == CHDERR_NONE) {
    want = h->logicalbytes;
  } else {
    return 1; /* a GD-ROM (CHGD) or an image of no kind we hash */
  }

  crc_init();
  uint32_t crc = 0;
  uint64_t done = 0;
  for (uint32_t hunk = 0; hunk < h->totalhunks && done < want; hunk++) {
    if (chd_read(chd, hunk, buf) != CHDERR_NONE) return 1;
    if (cd) {
      for (uint32_t off = 0; off + FRAME <= hunk_bytes && done < want; off += FRAME) {
        uint32_t n = keep;
        if (done + n > want) n = (uint32_t)(want - done);
        crc = crc_update(crc, buf + off, n);
        done += n;
      }
    } else {
      uint64_t n = hunk_bytes;
      if (done + n > want) n = want - done;
      crc = crc_update(crc, buf, (size_t)n);
      done += n;
    }
  }
  if (done != want) return 1;
  printf("%08x %" PRIu64 "\n", crc, done);
  chd_close(chd);
  free(buf);
  return 0;
}
