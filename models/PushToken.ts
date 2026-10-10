import { z } from 'zod';
import { pushTokens } from '../config/schema';
import { oneOf, requiredString } from '../utils/validation';

export { pushTokens };

/** Expo issues both prefixes depending on SDK version. */
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;
const PUSH_PLATFORMS = ['android', 'ios'] as const;

export const registerPushTokenSchema = z.object({
  token: requiredString('Push token is required').regex(EXPO_TOKEN, { error: 'Push token is not a valid Expo push token' }),
  platform: oneOf(PUSH_PLATFORMS, 'Platform').default('android')
});

export const removePushTokenSchema = z.object({
  token: requiredString('Push token is required')
});
