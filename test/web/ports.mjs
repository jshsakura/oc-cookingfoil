// The port a checkout's web suite listens on. Chromium refuses to open a page on some ports
// (net/base/port_util.cc, kRestrictedPorts) with ERR_UNSAFE_PORT, which made every test of a checkout
// fail in 100 ms when its folder happened to hash to one of them.
export const RESTRICTED_PORTS = Object.freeze(new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115,
  117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587,
  601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]));

export const FIRST_PORT = 3188;
export const SLOTS = 1000;

/** The slot-th port from FIRST_PORT on that Chromium allows: one port per slot, so two slots never share one. */
export function webTestPort(slot) {
  let seen = -1;
  for (let port = FIRST_PORT; ; port++) {
    if (RESTRICTED_PORTS.has(port)) continue;
    if (++seen === slot) return port;
  }
}
