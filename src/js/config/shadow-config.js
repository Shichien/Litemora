/**
 * Shadow quality configuration
 * Defines three quality levels for shadow casting
 *
 * - LOW: No shadows at all
 * - MEDIUM: Only player and trees cast shadows
 * - HIGH: All terrain blocks cast shadows
 */

export const SHADOW_QUALITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
}

export const SHADOW_CONFIG = {
  quality: SHADOW_QUALITY.HIGH, // Default to high quality
}
