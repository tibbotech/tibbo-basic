#include "global.th"



void boot() {

    device_net_ip = "192.168.1.101";
    device_net_mask = "255.255.255.0";
    device_net_gateway = "192.168.1.1";
    //Ethernet setup
    //================================================================
    net.ip = device_net_ip;
    net.netmask = device_net_mask;
    net.gatewayip = device_net_gateway;
    //-----------------------------------------------------------------
current_interface = PL_SOCK_INTERFACE_NULL;
    unsigned char f;
    for (f=0; f <= MAX_NUM_INTERFACES-1; f++) {
        interface_ready[f] = NO;
    }

    beep.divider = 11111;

    //HTTP server setup
    //================================================================
    unsigned char http_server_count;
    for (http_server_count=0; http_server_count <= 3; http_server_count++) {//allocate sockets for the webserver
        sock.num = sock_get("W"+str(http_server_count));
        sock.connectiontout = 120;
        sock.txbuffrq(10);
        sock.varbuffrq(1);
        sys.buffalloc();
        sock.redir(PL_REDIR_SOCK0+sock.num);

        sock.protocol = PL_SOCK_PROTOCOL_TCP;
        sock.httpportlist = "80";
        sock.allowedinterfaces = "NET,WLN";
        sock.inconmode = PL_SOCK_INCONMODE_ANY_IP_ANY_PORT;
    }
    //visit the device ip on a browser to see index.html being served
    //-----------------------------------------------------------------

    //Fd(flash disk) setup
    //================================================================
    if (fd.mount()) {
        if (fd.formatj(fd.availableflashspace/2,32,100) != PL_FD_STATUS_OK) {
            sys.halt();
        }

        if (fd.mount()) {
            sys.halt();
        }
    }
    //-----------------------------------------------------------------

    //Tables setup
    //================================================================
    if (tbl_start() != EN_TBL_STATUS_OK) {
        sys.halt();
    }
    //-----------------------------------------------------------------

    tbl_web_start();
    bool schema_changed = false;
    tbl_web_set("LOG",true);



    if (tbl_schema_check(TBL_DESCRIPTOR_FILE) != EN_TBL_STATUS_OK) {
        schema_changed = YES;
    }

    if (schema_changed == YES) {
        sys.debugprint("TBL> Schema changed, formatting flash");
        if (fd.formatj(fd.availableflashspace/2,32,100) != PL_FD_STATUS_OK) {
            sys.halt();
        }
        if (tbl_start() != EN_TBL_STATUS_OK) {
            sys.halt();
        }
        if (tbl_schema_check(TBL_DESCRIPTOR_FILE) != EN_TBL_STATUS_OK) { sys.halt();}
    }


    // Set the timezone to UTC-12:00
    APP_TIMEZONE = "0";
    datetime_tz_offset = APP_TIMEZONE;

    if (net.linkstate != PL_NET_LINKSTAT_NOLINK) {
        interface_set(PL_SOCK_INTERFACE_NET,YES);
    }

// Set the timezone to UTC-12:00
APP_TIMEZONE = "0";

    pat.play("B-B-B-",PL_PAT_CANINT);

}