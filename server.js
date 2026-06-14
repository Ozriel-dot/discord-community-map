const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const express = require("express");
const fs = require("fs");
const path = require("path");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

// --- CONFIGURATION ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 3000;

// Path configured specifically for Railway's Persistent Volume mount point
const DATA_DIR = "/app/data";
const DATA_FILE = path.join(DATA_DIR, "locations.json");

// Ensure directory and file persist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({}));
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName("setlocation")
    .setDescription("Pins your location on the community map!")
    .addStringOption((option) =>
      option
        .setName("place")
        .setDescription(
          "City, state, or country (Do NOT use exact home addresses!)"
        )
        .setRequired(true)
    ),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Slash commands registered successfully.");
  } catch (error) {
    console.error(error);
  }
})();

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "setlocation") {
    await interaction.deferReply({ ephemeral: true });
    const place = interaction.options.getString("place");

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        place
      )}&limit=1`;
      const response = await fetch(url, {
        headers: { "User-Agent": "DiscordCommunityMapBot/1.0" },
      });
      const data = await response.json();

      if (!data || data.length === 0) {
        return interaction.editReply({
          content: `❌ Could not find "${place}". Try a nearby major city.`,
        });
      }

      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      const fileData = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

      fileData[interaction.user.id] = {
        username: interaction.user.username,
        displayName: interaction.user.globalName || interaction.user.username,
        avatar: interaction.user.displayAvatarURL({
          extension: "png",
          size: 128,
        }),
        lat: lat,
        lon: lon,
        placeName: data[0].display_name.split(",")[0],
      };

      fs.writeFileSync(DATA_FILE, JSON.stringify(fileData, null, 4));
      await interaction.editReply({
        content: `📍 You're pinned to **${
          fileData[interaction.user.id].placeName
        }** on the map!`,
      });
    } catch (error) {
      console.error(error);
      await interaction.editReply({
        content: "❌ Error pinpointing location coordinates.",
      });
    }
  }
});

client.login(TOKEN);

const app = express();
app.use(express.static(__dirname));
app.get("/api/locations", (req, res) => {
  const fileData = fs.readFileSync(DATA_FILE, "utf8");
  res.json(JSON.parse(fileData));
});
app.listen(PORT, () => {
  console.log(`🌐 Server operating successfully on port ${PORT}`);
});
