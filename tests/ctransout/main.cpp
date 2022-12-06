#include "global.th"




string<16> device_net_ip;
string<16> device_net_mask;
string<16> device_net_gateway;
no_yes interface_ready[MAX_NUM_INTERFACES];
pl_sock_interfaces current_interface;
en_td_timezones APP_TIMEZONE;
unsigned char upgrade_socket_http = 255;

void fbyref(unsigned char *aa) {
	*aa = *aa+1;
}

void on_sys_init() {
    unsigned char iii = 0;
    fbyref(iii);
    boot();
}


void on_sys_timer() {
    dhcp_proc_timer();

}


void on_sock_data_arrival() {
    dhcp_proc_data();

}


void on_net_link_change() {

    if (net.linkstate == PL_NET_LINKSTAT_NOLINK) {
        interface_set(PL_SOCK_INTERFACE_NET,NO);
    } else {
        interface_set(PL_SOCK_INTERFACE_NET,YES);
    }

}


void on_sock_postdata() {

if (upload_started == false) {
    device_firmware_upload_async(PL_FW_UPG_HTTP,0);
    upload_started = true;
} else {
    device_firmware_upload_update();
}

}


void on_sock_event(pl_sock_state newstate, pl_sock_state_simple newstatesimple) {

if (sock.num == upgrade_socket_http && newstatesimple == PL_SSTS_CLOSED) {
    while (sock.varlen != 0) {
        if (upload_started == false) {
            device_firmware_upload_async(PL_FW_UPG_HTTP,0);
            upload_started = true;
        } else {
            device_firmware_upload_update();
        }
    }
    upgrade_socket_http = 255;
}

}

