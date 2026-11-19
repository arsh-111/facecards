import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './constants';

/** `randomInt(n)` must return a uniformly random integer in [0, n). Use crypto on the server. */
export function generateRoomCode(randomInt: (n: number) => number): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export function isValidRoomCode(code: string): boolean {
  return (
    code.length === ROOM_CODE_LENGTH && [...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch))
  );
}
