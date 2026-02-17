package org.mego.config;

public class ServerInfo {
    public String name;
    public String user;
    public String host;
    public String port;
    public String password;

    public ServerInfo() {}

    public ServerInfo(String name, String user, String host, String port, String password) {
        this.name = name;
        this.user = user;
        this.host = host;
        this.port = port;
        this.password = password;
    }
}
