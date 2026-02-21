package main.config;

import java.util.Objects;

public class ServerInfo {
    public String name;
    public String user;
    public String host;
    public String port;
    public String password;
    public String identityFile;
    public String osPrettyName;

    public ServerInfo() {
    }

    public ServerInfo(String name, String user, String host, String port, String password, String identityFile) {
        this.name = name;
        this.user = user;
        this.host = host;
        this.port = port;
        this.password = password;
        this.identityFile = identityFile;
    }

    public ServerInfo(String name, String user, String host, String port, String password, String identityFile, String osPrettyName) {
        this(name, user, host, port, password, identityFile);
        this.osPrettyName = osPrettyName;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ServerInfo that = (ServerInfo) o;
        return Objects.equals(name, that.name) &&
                Objects.equals(user, that.user) &&
                Objects.equals(host, that.host) &&
                Objects.equals(port, that.port) &&
                Objects.equals(password, that.password) &&
                Objects.equals(identityFile, that.identityFile) &&
                Objects.equals(osPrettyName, that.osPrettyName);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, user, host, port, password, identityFile, osPrettyName);
    }
}