package org.mego.config;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

public class FavoritesManager {
    private static final String FAVORITES_FILE = System.getProperty("user.home") + File.separator + ".minissh_favorites.txt";

    public static class Favorite {
        public String name;
        public String user;
        public String host;
        public String port;
        public String password;

        public Favorite(String name, String user, String host, String port, String password) {
            this.name = name;
            this.user = user;
            this.host = host;
            this.port = port;
            this.password = password == null ? "" : password;
        }
    }

    public List<Favorite> loadFavorites() {
        List<Favorite> favorites = new ArrayList<>();
        try {
            if (Files.exists(Paths.get(FAVORITES_FILE))) {
                List<String> lines = Files.readAllLines(Paths.get(FAVORITES_FILE));
                for (String line : lines) {
                    if (line.trim().isEmpty()) continue;
                    String[] parts = line.split("\t", 5);
                    if (parts.length >= 4) {
                        String name = parts[0];
                        String user = parts[1];
                        String host = parts[2];
                        String port = parts[3];
                        String password = parts.length == 5 ? decrypt(parts[4]) : "";
                        favorites.add(new Favorite(name, user, host, port, password));
                    }
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return favorites;
    }

    public void saveFavorite(Favorite fav) {
        try {
            String entry = String.format("%s\t%s\t%s\t%s\t%s", fav.name, fav.user, fav.host, fav.port, encrypt(fav.password));
            Files.write(Paths.get(FAVORITES_FILE), (entry + System.lineSeparator()).getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private String encrypt(String s) {
        if (s == null || s.isEmpty()) return "";
        return Base64.getEncoder().encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }

    private String decrypt(String s) {
        if (s == null || s.isEmpty()) return "";
        try {
            return new String(Base64.getDecoder().decode(s), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return s;
        }
    }
}
