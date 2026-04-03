export const REFRESH_SECONDS = 30;
export const TELEMETRY_REFRESH_SECONDS = 10;
export const DEFAULT_ARTEMIS_II_LAUNCH_ISO = "2026-04-01T22:35:13Z";
export const ARTEMIS_II_LAUNCH_ISO = process.env.ARTEMIS_II_LAUNCH_ISO ?? DEFAULT_ARTEMIS_II_LAUNCH_ISO;
export const TV_BROADCAST_XLS_PATH =
  process.env.TV_BROADCAST_XLS_PATH ?? "/Users/mac/Downloads/artemis-ii-tv-schedule-rev-a-1.xls";

export const SOURCE_URLS = {
  broadcast: "https://www.youtube.com/watch?v=m3kR2KK8TEs",
  orionViews: "https://www.youtube.com/watch?v=6RwfNBtepa4",
  nasaLiveHub: "https://www.nasa.gov/live/",
  artemisMission: "https://www.nasa.gov/mission/artemis-ii/",
  artemisUpdates: "https://www.nasa.gov/artemis-ii-news-and-updates/",
  missionBlogFeed: "https://www.nasa.gov/blogs/missions/feed/",
  artemisTrackInfo:
    "https://www.nasa.gov/missions/artemis/artemis-2/track-nasas-artemis-ii-mission-in-real-time/",
  artemisArow: "https://www.nasa.gov/missions/artemis-ii/arow/",
  artemisArowBuildData: "https://www.nasa.gov/missions/artemis-ii/arow/Build/WebBuildMar27.data",
  trackArtemis: "https://www.nasa.gov/trackartemis",
  dsnNow: "https://eyes.nasa.gov/apps/dsn-now/dsn.html",
  dsnXml: "https://eyes.nasa.gov/dsn/data/dsn.xml",
  nasaApp: "https://www.nasa.gov/nasa-app",
  artemisWpPosts:
    "https://www.nasa.gov/wp-json/wp/v2/posts?search=Artemis%20II&per_page=20&_fields=id,date,link,title.rendered,excerpt.rendered",
  horizons: "https://ssd.jpl.nasa.gov/api/horizons.api"
};
