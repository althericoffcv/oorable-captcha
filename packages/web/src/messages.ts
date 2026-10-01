/**
 * User-facing strings. Every string the widget shows lives here so it can be
 * translated or overridden (`messages` option) without touching the widget.
 *
 * Bundled: English, Indonesian, Spanish, French, German, Portuguese. The
 * translations have not been reviewed by native-speaker QA -- treat them as a
 * good starting point and override any string you want to tune.
 */
export interface Messages {
  title: string;
  tagline: string;
  puzzleInstructions: string;
  textInstructions: string;
  imageInstructions: string;
  codeLabel: string;
  codeImageAlt: string;
  verify: string;
  newPuzzle: string;
  newCode: string;
  tryAgain: string;
  loading: string;
  verifying: string;
  success: string;
  incorrect: string;
  emptyAnswer: string;
  expired: string;
  tooManyAttempts: string;
  invalid: string;
  networkError: string;
  misconfigured: string;
  rateLimited: string;
  gridLabel: string;
  tileLabel: string;
  pickedUp: string;
  dropped: string;
  swapped: string;
  imageOption: string;
  selectedCount: string;
}

const en: Messages = {
  title: "OORABLE CAPTCHA",
  tagline: "Human Verification System",
  puzzleInstructions: "Put the meme back together. Tap one piece, then another, to swap them.",
  textInstructions: "Type the characters you see in the picture.",
  imageInstructions: "Select the matching pictures.",
  codeLabel: "Characters",
  codeImageAlt: "Distorted characters to copy",
  verify: "Verify",
  newPuzzle: "New puzzle",
  newCode: "New code",
  tryAgain: "Try again",
  loading: "Loading your challenge…",
  verifying: "Checking…",
  success: "Nice, you're verified.",
  incorrect: "Not quite. Give it another go.",
  emptyAnswer: "Please enter the characters first.",
  expired: "That challenge expired. Here's a fresh one.",
  tooManyAttempts: "Too many tries on that one. Here's a fresh one.",
  invalid: "That challenge is no longer valid. Here's a fresh one.",
  networkError: "Couldn't reach the verification server. Check your connection and try again.",
  misconfigured: "This CAPTCHA isn't set up for this site. Please contact the site owner.",
  rateLimited: "Too many requests. Please wait {seconds}s and try again.",
  gridLabel: "Puzzle pieces, {n} by {n}",
  tileLabel: "Row {row}, column {col}",
  pickedUp: "Picked up the piece at row {row}, column {col}. Choose another piece to swap with.",
  dropped: "Put the piece back.",
  swapped: "Swapped row {r1}, column {c1} with row {r2}, column {c2}.",
  imageOption: "Image {n}",
  selectedCount: "{selected} of {total} selected",
};

const id: Messages = {
  title: "OORABLE CAPTCHA",
  tagline: "Sistem Verifikasi Manusia",
  puzzleInstructions: "Susun kembali meme-nya. Ketuk satu kepingan, lalu kepingan lain untuk menukarnya.",
  textInstructions: "Ketik karakter yang kamu lihat pada gambar.",
  imageInstructions: "Pilih gambar yang sesuai.",
  codeLabel: "Karakter",
  codeImageAlt: "Karakter terdistorsi untuk disalin",
  verify: "Verifikasi",
  newPuzzle: "Puzzle baru",
  newCode: "Kode baru",
  tryAgain: "Coba lagi",
  loading: "Memuat tantangan…",
  verifying: "Memeriksa…",
  success: "Mantap, kamu terverifikasi.",
  incorrect: "Belum tepat. Coba lagi.",
  emptyAnswer: "Masukkan karakternya dulu.",
  expired: "Tantangan itu kedaluwarsa. Ini yang baru.",
  tooManyAttempts: "Terlalu banyak percobaan. Ini yang baru.",
  invalid: "Tantangan itu sudah tidak berlaku. Ini yang baru.",
  networkError: "Tidak dapat terhubung ke server verifikasi. Periksa koneksi lalu coba lagi.",
  misconfigured: "CAPTCHA ini belum diatur untuk situs ini. Hubungi pemilik situs.",
  rateLimited: "Terlalu banyak permintaan. Tunggu {seconds} detik lalu coba lagi.",
  gridLabel: "Kepingan puzzle, {n} kali {n}",
  tileLabel: "Baris {row}, kolom {col}",
  pickedUp: "Kepingan di baris {row}, kolom {col} dipilih. Pilih kepingan lain untuk menukar.",
  dropped: "Kepingan dilepas.",
  swapped: "Menukar baris {r1}, kolom {c1} dengan baris {r2}, kolom {c2}.",
  imageOption: "Gambar {n}",
  selectedCount: "{selected} dari {total} dipilih",
};

const es: Messages = {
  title: "OORABLE CAPTCHA",
  tagline: "Sistema de verificación humana",
  puzzleInstructions: "Vuelve a armar el meme. Toca una pieza y luego otra para intercambiarlas.",
  textInstructions: "Escribe los caracteres que ves en la imagen.",
  imageInstructions: "Selecciona las imágenes que coinciden.",
  codeLabel: "Caracteres",
  codeImageAlt: "Caracteres distorsionados para copiar",
  verify: "Verificar",
  newPuzzle: "Nuevo rompecabezas",
  newCode: "Nuevo código",
  tryAgain: "Reintentar",
  loading: "Cargando el desafío…",
  verifying: "Comprobando…",
  success: "¡Listo! Estás verificado.",
  incorrect: "No del todo. Inténtalo de nuevo.",
  emptyAnswer: "Escribe primero los caracteres.",
  expired: "Ese desafío caducó. Aquí tienes uno nuevo.",
  tooManyAttempts: "Demasiados intentos con ese. Aquí tienes uno nuevo.",
  invalid: "Ese desafío ya no es válido. Aquí tienes uno nuevo.",
  networkError: "No se pudo conectar con el servidor de verificación. Revisa tu conexión e inténtalo de nuevo.",
  misconfigured: "Este CAPTCHA no está configurado para este sitio. Contacta al propietario del sitio.",
  rateLimited: "Demasiadas solicitudes. Espera {seconds} s e inténtalo de nuevo.",
  gridLabel: "Piezas del rompecabezas, {n} por {n}",
  tileLabel: "Fila {row}, columna {col}",
  pickedUp: "Pieza de la fila {row}, columna {col} seleccionada. Elige otra pieza para intercambiar.",
  dropped: "Pieza soltada.",
  swapped: "Intercambiadas la fila {r1}, columna {c1} y la fila {r2}, columna {c2}.",
  imageOption: "Imagen {n}",
  selectedCount: "{selected} de {total} seleccionadas",
};

const fr: Messages = {
  title: "OORABLE CAPTCHA",
  tagline: "Système de vérification humaine",
  puzzleInstructions: "Reconstituez le mème. Touchez une pièce, puis une autre, pour les échanger.",
  textInstructions: "Saisissez les caractères visibles sur l'image.",
  imageInstructions: "Sélectionnez les images correspondantes.",
  codeLabel: "Caractères",
  codeImageAlt: "Caractères déformés à recopier",
  verify: "Vérifier",
  newPuzzle: "Nouveau puzzle",
  newCode: "Nouveau code",
  tryAgain: "Réessayer",
  loading: "Chargement du défi…",
  verifying: "Vérification…",
  success: "Parfait, vous êtes vérifié.",
  incorrect: "Pas tout à fait. Réessayez.",
  emptyAnswer: "Saisissez d'abord les caractères.",
  expired: "Ce défi a expiré. En voici un nouveau.",
  tooManyAttempts: "Trop d'essais sur celui-ci. En voici un nouveau.",
  invalid: "Ce défi n'est plus valide. En voici un nouveau.",
  networkError: "Impossible de joindre le serveur de vérification. Vérifiez votre connexion et réessayez.",
  misconfigured: "Ce CAPTCHA n'est pas configuré pour ce site. Contactez le propriétaire du site.",
  rateLimited: "Trop de demandes. Patientez {seconds} s puis réessayez.",
  gridLabel: "Pièces du puzzle, {n} sur {n}",
  tileLabel: "Ligne {row}, colonne {col}",
  pickedUp: "Pièce de la ligne {row}, colonne {col} sélectionnée. Choisissez une autre pièce pour l'échanger.",
  dropped: "Pièce reposée.",
  swapped: "Échange de la ligne {r1}, colonne {c1} avec la ligne {r2}, colonne {c2}.",
  imageOption: "Image {n}",
  selectedCount: "{selected} sur {total} sélectionnées",
};

const de: Messages = {
  title: "OORABLE CAPTCHA",
  tagline: "System zur Verifizierung von Menschen",
  puzzleInstructions: "Setze das Meme wieder zusammen. Tippe ein Teil an, dann ein zweites, um sie zu tauschen.",
  textInstructions: "Gib die Zeichen ein, die du im Bild siehst.",
  imageInstructions: "Wähle die passenden Bilder aus.",
  codeLabel: "Zeichen",
  codeImageAlt: "Verzerrte Zeichen zum Abtippen",
  verify: "Prüfen",
  newPuzzle: "Neues Puzzle",
  newCode: "Neuer Code",
  tryAgain: "Erneut versuchen",
  loading: "Aufgabe wird geladen…",
  verifying: "Wird geprüft…",
  success: "Geschafft, du bist verifiziert.",
  incorrect: "Nicht ganz. Versuch es noch einmal.",
  emptyAnswer: "Bitte gib zuerst die Zeichen ein.",
  expired: "Diese Aufgabe ist abgelaufen. Hier ist eine neue.",
  tooManyAttempts: "Zu viele Versuche bei dieser. Hier ist eine neue.",
  invalid: "Diese Aufgabe ist nicht mehr gültig. Hier ist eine neue.",
  networkError: "Der Verifizierungsserver ist nicht erreichbar. Prüfe deine Verbindung und versuche es erneut.",
  misconfigured: "Dieses CAPTCHA ist für diese Website nicht eingerichtet. Bitte kontaktiere den Betreiber.",
  rateLimited: "Zu viele Anfragen. Bitte warte {seconds} s und versuche es erneut.",
  gridLabel: "Puzzleteile, {n} mal {n}",
  tileLabel: "Zeile {row}, Spalte {col}",
  pickedUp: "Teil in Zeile {row}, Spalte {col} aufgenommen. Wähle ein anderes Teil zum Tauschen.",
  dropped: "Teil wieder abgelegt.",
  swapped: "Zeile {r1}, Spalte {c1} mit Zeile {r2}, Spalte {c2} getauscht.",
  imageOption: "Bild {n}",
  selectedCount: "{selected} von {total} ausgewählt",
};

const pt: Messages = {
  title: "OORABLE CAPTCHA",
  tagline: "Sistema de verificação humana",
  puzzleInstructions: "Monte o meme de novo. Toque em uma peça e depois em outra para trocá-las.",
  textInstructions: "Digite os caracteres que você vê na imagem.",
  imageInstructions: "Selecione as imagens correspondentes.",
  codeLabel: "Caracteres",
  codeImageAlt: "Caracteres distorcidos para copiar",
  verify: "Verificar",
  newPuzzle: "Novo quebra-cabeça",
  newCode: "Novo código",
  tryAgain: "Tentar de novo",
  loading: "Carregando o desafio…",
  verifying: "Verificando…",
  success: "Pronto, você foi verificado.",
  incorrect: "Quase lá. Tente de novo.",
  emptyAnswer: "Digite os caracteres primeiro.",
  expired: "Esse desafio expirou. Aqui vai um novo.",
  tooManyAttempts: "Tentativas demais nesse. Aqui vai um novo.",
  invalid: "Esse desafio não é mais válido. Aqui vai um novo.",
  networkError: "Não foi possível conectar ao servidor de verificação. Verifique sua conexão e tente novamente.",
  misconfigured: "Este CAPTCHA não está configurado para este site. Entre em contato com o proprietário do site.",
  rateLimited: "Muitas solicitações. Aguarde {seconds} s e tente novamente.",
  gridLabel: "Peças do quebra-cabeça, {n} por {n}",
  tileLabel: "Linha {row}, coluna {col}",
  pickedUp: "Peça da linha {row}, coluna {col} selecionada. Escolha outra peça para trocar.",
  dropped: "Peça solta.",
  swapped: "Trocadas a linha {r1}, coluna {c1} e a linha {r2}, coluna {c2}.",
  imageOption: "Imagem {n}",
  selectedCount: "{selected} de {total} selecionadas",
};

export const BUNDLED_MESSAGES: Record<string, Messages> = { en, id, es, fr, de, pt };

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi", "dv", "ckb"]);

function languageOf(locale: string | undefined): string {
  return (locale ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
}

export function isRtl(locale: string | undefined): boolean {
  return RTL_LANGUAGES.has(languageOf(locale));
}

/** Picks the bundled language matching `locale` (falling back to English), then applies overrides. */
export function resolveMessages(locale: string | undefined, overrides: Partial<Messages> = {}): Messages {
  return { ...(BUNDLED_MESSAGES[languageOf(locale)] ?? en), ...overrides };
}

/** Replaces `{name}` placeholders. Unknown placeholders are left as-is; values are never interpreted as markup. */
export function formatMessage(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}
