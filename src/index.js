require('dotenv').config();
const Parser = require('rss-parser');
const { Client } = require('@notionhq/client');
const TurndownService = require('turndown');

// Initialize clients
const notion = new Client({ auth: process.env.NOTION_API_TOKEN });
const parser = new Parser();
const turndownService = new TurndownService();

// Normalize title to strip HTML and extra whitespace
function normalizeTitle(title) {
  return turndownService.turndown(title).replace(/\s+/g, ' ').trim();
}

// Check if an item exists in the Reader database
async function itemExists(item) {
  const cleanTitle = normalizeTitle(item.title);
  const cleanUrl = item.link;
  try {
    const response = await notion.databases.query({
      database_id: process.env.NOTION_READER_DATABASE_ID,
      filter: {
        or: [
          { property: 'Title', title: { equals: cleanTitle } },
          { property: 'URL', url: { equals: cleanUrl } },
        ],
      },
    });
    return response.results.length > 0;
  } catch (error) {
    console.error(`Error checking duplicate: ${error.message}`);
    return false; // Assume no duplicate if query fails
  }
}

// Add a new item to the Reader database
async function addFeedItem(item) {
  const cleanTitle = normalizeTitle(item.title);
  try {
    await notion.pages.create({
      parent: { database_id: process.env.NOTION_READER_DATABASE_ID },
      properties: {
        Title: { title: [{ text: { content: cleanTitle } }] },
        URL: { url: item.link },
        Date: { date: { start: item.isoDate || new Date().toISOString() } },
        Source: { rich_text: [{ text: { content: item.creator || 'Unknown' } }] },
      },
    });
    console.log(`Added item: ${cleanTitle}`);
  } catch (error) {
    console.error(`Error adding item "${cleanTitle}": ${error.message}`);
  }
}

// Fetch and process feeds
async function fetchFeeds() {
  try {
    // Get feed URLs from Feeds database
    const feedsResponse = await notion.databases.query({
      database_id: process.env.NOTION_FEEDS_DATABASE_ID,
    });
    const feeds = feedsResponse.results.map(
      (page) => page.properties.URL.url
    );

    // Process each feed
    for (const feedUrl of feeds) {
      console.log(`Processing feed: ${feedUrl}`);
      try {
        const feed = await parser.parseURL(feedUrl);
        for (const item of feed.items) {
          if (await itemExists(item)) {
            console.log(`Skipping duplicate: ${item.title}`);
            continue;
          }
          await addFeedItem(item);
        }
      } catch (error) {
        console.error(`Error processing feed ${feedUrl}: ${error.message}`);
      }
    }
  } catch (error) {
    console.error(`Error fetching feeds: ${error.message}`);
  }
}

// Run the feeder
(async () => {
  console.log('Starting Notion Feeder...');
  await fetchFeeds();
  console.log('Finished processing feeds.');
})();
