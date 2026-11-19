/**
 * Why an enrollment is parked, where more than one place needs to agree.
 *
 * `advance_enrollments` parks an enrollment whose campaign is not running.
 * Starting that campaign is what un-parks it (`saveCampaignAction`), and the
 * two find each other by this string. It is the exact text rows were parked
 * with before this constant existed, so enrollments parked by an older build
 * are released by the same rule (PANEL-301, pass 20).
 *
 * Its own module so the web app can import it without loading a handler.
 */
export const CAMPAIGN_NOT_RUNNING = "The campaign is not running.";
