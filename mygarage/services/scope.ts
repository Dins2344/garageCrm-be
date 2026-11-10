// Stored scope: 'u:<userId>' or 'g:<garageId>'. Wire scope: 'personal' or the garage id.
export const WIRE_PERSONAL = 'personal';

export const personalScope = (userId: string): string => `u:${userId}`;
export const garageScope = (garageId: string): string => `g:${garageId}`;
export const toWire = (scope: string): string => (scope.startsWith('g:') ? scope.slice(2) : WIRE_PERSONAL);
export const garageIdOf = (scope: string): string | null => (scope.startsWith('g:') ? scope.slice(2) : null);
