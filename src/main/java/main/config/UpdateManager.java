package main.config;

import com.google.gson.Gson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.CompletableFuture;

public class UpdateManager {
    private static final Logger LOGGER = LoggerFactory.getLogger(UpdateManager.class);
    private static final String GITHUB_API_URL = "https://api.github.com/repos/megoRU/YetAnotherSSHClient/releases/latest";
    private static final String USER_AGENT = "YetAnotherSSHClient-Updater";

    private String currentVersion = "unknown";
    private final ConfigManager configManager;
    private GitHubRelease latestRelease;

    public UpdateManager(ConfigManager configManager) {
        this.configManager = configManager;
        loadCurrentVersion();
    }

    private void loadCurrentVersion() {
        try (InputStream input = getClass().getResourceAsStream("/version.properties")) {
            if (input != null) {
                Properties prop = new Properties();
                prop.load(input);
                currentVersion = prop.getProperty("version", "unknown");
            }
        } catch (Exception e) {
            LOGGER.error("Failed to load version.properties", e);
        }
    }

    public String getCurrentVersion() {
        return currentVersion;
    }

    public CompletableFuture<GitHubRelease> checkForUpdates() {
        long now = System.currentTimeMillis();
        long lastCheck = configManager.getLastUpdateCheck();

        // Check only once a day (24 hours = 86400000 ms)
        if (now - lastCheck < 86400000) {
            return CompletableFuture.completedFuture(null);
        }

        configManager.setLastUpdateCheck(now);
        configManager.save();

        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(GITHUB_API_URL))
                .header("User-Agent", USER_AGENT)
                .build();

        return client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenApply(response -> {
                    if (response.statusCode() == 200) {
                        GitHubRelease release = new Gson().fromJson(response.body(), GitHubRelease.class);
                        if (isNewer(release.tag_name, currentVersion)) {
                            this.latestRelease = release;
                            return release;
                        }
                    }
                    return null;
                })
                .exceptionally(ex -> {
                    LOGGER.error("Failed to check for updates", ex);
                    return null;
                });
    }

    private boolean isNewer(String latestTag, String current) {
        if (latestTag == null || current == null || "unknown".equals(current)) return false;

        // Clean tags from 'v' prefix if present
        String v1 = latestTag.startsWith("v") ? latestTag.substring(1) : latestTag;
        String v2 = current.startsWith("v") ? current.substring(1) : current;

        String[] parts1 = v1.split("\\.");
        String[] parts2 = v2.split("\\.");

        int length = Math.max(parts1.length, parts2.length);
        for (int i = 0; i < length; i++) {
            try {
                int p1 = i < parts1.length ? Integer.parseInt(parts1[i].replaceAll("[^0-9]", "")) : 0;
                int p2 = i < parts2.length ? Integer.parseInt(parts2[i].replaceAll("[^0-9]", "")) : 0;
                if (p1 > p2) return true;
                if (p1 < p2) return false;
            } catch (NumberFormatException e) {
                // ignore
            }
        }
        return false;
    }

    public GitHubRelease getLatestRelease() {
        return latestRelease;
    }

    public static class GitHubRelease {
        public String tag_name;
        public String body;
        public List<Asset> assets;

        public static class Asset {
            public String name;
            public String browser_download_url;
        }
    }
}
