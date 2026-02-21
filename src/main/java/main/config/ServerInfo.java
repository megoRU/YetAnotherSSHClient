package main.config;

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
}