/** Marca vetorial do produto. Glifos derivados de DejaVu Sans Bold; licença em docs/brand/FONT-LICENSE.txt. */
export type Glifo = { readonly transform: string; readonly d: string };
export const SIMBOLO = {
  viewBox: "0 0 216 216",
  transform: "translate(0 0)",
  d: "M122 20 40 116H94L74 196 180 88H124Z",
  modulo: {
    x: 167,
    y: 160,
    width: 14,
    height: 14,
    rx: 4,
  },
} as const;
export const LOGOTIPO = {
  viewBox: "0 0 920 216",
  proporcao: 4.2592592592592595,
  simbolo: {
    transform: SIMBOLO.transform,
    d: SIMBOLO.d,
    modulo: SIMBOLO.modulo,
  },
  nome: [
    {
      transform: "translate(225.000 139) scale(0.063 -0.063)",
      d: "M115 1493H1370V1260L569 291H1393V0H92V233L893 1202H115Z",
    },
    {
      transform: "translate(318.555 139) scale(0.063 -0.063)",
      d: "M674 504Q562 504 505.5 466.0Q449 428 449 354Q449 286 494.5 247.5Q540 209 621 209Q722 209 791.0 281.5Q860 354 860 463V504ZM1221 639V0H860V166Q788 64 698.0 17.5Q608 -29 479 -29Q305 -29 196.5 72.5Q88 174 88 336Q88 533 223.5 625.0Q359 717 649 717H860V745Q860 830 793.0 869.5Q726 909 584 909Q469 909 370.0 886.0Q271 863 186 817V1090Q301 1118 417.0 1132.5Q533 1147 649 1147Q952 1147 1086.5 1027.5Q1221 908 1221 639Z",
    },
    {
      transform: "translate(405.621 139) scale(0.063 -0.063)",
      d: "M530 162V-426H172V1120H530V956Q604 1054 694.0 1100.5Q784 1147 901 1147Q1108 1147 1241.0 982.5Q1374 818 1374 559Q1374 300 1241.0 135.5Q1108 -29 901 -29Q784 -29 694.0 17.5Q604 64 530 162ZM768 887Q653 887 591.5 802.5Q530 718 530 559Q530 400 591.5 315.5Q653 231 768 231Q883 231 943.5 315.0Q1004 399 1004 559Q1004 719 943.5 803.0Q883 887 768 887Z",
    },
    {
      transform: "translate(497.979 139) scale(0.063 -0.063)",
      d: "M188 1493H1227V1202H573V924H1188V633H573V0H188Z",
    },
    {
      transform: "translate(586.116 139) scale(0.063 -0.063)",
      d: "M172 1556H530V0H172Z",
    },
    {
      transform: "translate(630.342 139) scale(0.063 -0.063)",
      d: "M705 891Q586 891 523.5 805.5Q461 720 461 559Q461 398 523.5 312.5Q586 227 705 227Q822 227 884.0 312.5Q946 398 946 559Q946 720 884.0 805.5Q822 891 705 891ZM705 1147Q994 1147 1156.5 991.0Q1319 835 1319 559Q1319 283 1156.5 127.0Q994 -29 705 -29Q415 -29 251.5 127.0Q88 283 88 559Q88 835 251.5 991.0Q415 1147 705 1147Z",
    },
    {
      transform: "translate(718.983 139) scale(0.063 -0.063)",
      d: "M72 1120H420L608 348L797 1120H1096L1284 356L1473 1120H1821L1526 0H1135L946 770L758 0H367Z",
    },
  ],
  sufixo: [
    {
      transform: "translate(230.000 191) scale(0.022 -0.022)",
      d: "M1094 272H492L397 0H10L563 1493H1022L1575 0H1188ZM588 549H997L793 1143Z",
    },
    {
      transform: "translate(264.870 191) scale(0.022 -0.022)",
      d: "M188 1493H573V0H188Z",
    },
  ],
} as const;
export const CORES_DA_MARCA = {
  claro: {
    simbolo: "#506d48",
    nome: "#1c1a16",
    sufixo: "#5d594f",
  },
  escuro: {
    simbolo: "#82a077",
    nome: "#f5f4ef",
    sufixo: "#8e8b7f",
  },
} as const;
