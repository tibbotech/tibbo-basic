#include "global.th"




unsigned long datetime_timestamp_mins(unsigned long timestamp) {
unsigned long datetime_timestamp_mins;
    unsigned int days = 0;
    unsigned int mins = 0;
    unsigned char secs = 0;
    unsigned int mins_offset = 0;
    datetime_from_timestamp(timestamp,days,mins,secs);
    td_get_tzone_offset(APP_TIMEZONE,mins_offset);
    datetime_timestamp_mins = mins+mins_offset;
    return datetime_timestamp_mins;
}

unsigned long datetime_mins_to_timestamp(unsigned int mins) {
unsigned long datetime_mins_to_timestamp;
    unsigned int datetime_days, datetime_minutes;
    unsigned char datetime_secs;
    unsigned long timestamp = datetime_current_timestamp();
    datetime_from_timestamp(timestamp,datetime_days,datetime_minutes,datetime_secs);
    datetime_minutes = mins;
    td_local_to_gmt(datetime_days,datetime_minutes,APP_TIMEZONE,PL_OFF);
    datetime_mins_to_timestamp = datetime_to_timestamp(datetime_days,datetime_minutes,0);
    return datetime_mins_to_timestamp;
}


#if WLN_AVAILABLE
void callback_wln_failure(en_wln_status_codes wln_state) {

}
#endif


void callback_wln_ok() {

}


void callback_wln_starting_association() {

}


void callback_wln_pre_buffrq(unsigned char required_buff_pages) {

}


void callback_wln_mkey_progress_update(unsigned char progress) {

}


void callback_wln_rescan_result(unsigned char current_rssi, unsigned char scan_rssi, no_yes different_ap) {

}


void callback_wln_rescan_for_better_ap() {

}



void callback_dhcp_ok(no_yes renew, pl_sock_interfaces interface, string *ip, string *gateway_ip, string *netmask, unsigned long lease_time) {

}


void callback_dhcp_failure(pl_sock_interfaces interface, en_dhcp_status_codes failure_code) {

}


void callback_dhcp_pre_clear_ip(pl_sock_interfaces interface) {

}


void callback_dhcp_pre_buffrq(unsigned char required_buff_pages) {

}


void callback_dhcp_buff_released() {

}


void interface_set(pl_sock_interfaces interface, no_yes state) {
    pl_sock_interfaces best_interface = PL_SOCK_INTERFACE_NET;
    if (state == yes) {
        interface_ready[interface] = yes;
    } else {
        interface_ready[interface] = no;
    }
    if (interface_ready[PL_SOCK_INTERFACE_NET] == yes) {
        best_interface = PL_SOCK_INTERFACE_NET;
    } else {
        #IF WLN_AVAILABLE

            if (interface_ready[PL_SOCK_INTERFACE_WLN] == yes) {
                best_interface = PL_SOCK_INTERFACE_WLN;
            }
        #ENDIF
        #IF CELLULAR_AVAILABLE
            if (interface_ready[PL_SOCK_INTERFACE_PPP] == yes) {
                best_interface = PL_SOCK_INTERFACE_PPP;
            }
        #ENDIF
    }

    change_current_interface(best_interface);
}


void close_interface_sockets(pl_sock_interfaces interface) {
    unsigned char f, sock_num_bup;
    unsigned int i;

    sock_num_bup = sock.num;

    for (f=0; f <= sock.numofsock-1; f++) {
        sock.num = f;
        if (sock.targetinterface == interface) {
            sock.close();
            sock.discard();
        }
    }

    i = sys.timercount;

    wait_close_interface_sockets: 
    for (f=0; f <= sock.numofsock-1; f++) {
        sock.num = f;
        if (sock.targetinterface == interface && sock.statesimple != PL_SSTS_CLOSED && sys.timercount-i<5 && sys.timercount>=i) {
            goto wait_close_interface_sockets;
        }
    }

    sock.num = sock_num_bup;

}


void change_current_interface(pl_sock_interfaces new_interface) {
    if (current_interface != new_interface) {


        sock.inconenabledmaster = NO;
        close_interface_sockets(current_interface);

        current_interface = new_interface;

        switch (current_interface) {
            case PL_SOCK_INTERFACE_NET:
sys.debugprint("Set current interface to Ethernet\r\n");
            break;

            case PL_SOCK_INTERFACE_WLN:
sys.debugprint("Set current interface to Wi-Fi\r\n");
            break;

            case PL_SOCK_INTERFACE_PPP:
sys.debugprint("Set current interface to GPRS\r\n");
            break;
        }
        sock.inconenabledmaster = YES;
        if (new_interface != PL_SOCK_INTERFACE_NULL) {

        }
    }
}

void on_firmware_update_start(pl_upg_state_t *current_fw_upg_state) {

}

void on_firmware_update_data_received(pl_upg_state_t *current_fw_upg_state) {

}

void on_firmware_update_percent_change(pl_upg_state_t *current_fw_upg_state) {

    sys.debugprint(str(*current_fw_upg_state.fw_percent)+"%\r\n");
}

void on_firmware_update_file_complete(pl_upg_state_t *current_fw_upg_state) {

}

void on_firmware_update_complete(pl_upg_state_t *current_fw_upg_state) {

    sys.debugprint("All files have been downloaded.\r\n");

    int i;
    pl_wln_module_types module_type;


    if (*current_fw_upg_state.fw_fail_reason != PL_FW_FAIL_NONE) {
        sys.debugprint("There was a failure return this to the browser.\r\n");
    }

    sys.debugprint("All files have been downloaded.\r\n");

    if (*current_fw_upg_state.state != PL_FW_UPG_COMPLETE) {
        return;
    }

    pat.play("B~",PL_PAT_CANINT);

    //i = get_firmware_index(WA2000_MON)
    //if i >= 0 then
    //   upgrade_WA2000_firmware(WA2000_MON, i)
    //end if

    i = get_firmware_index(WA2000_APP);

    i = get_firmware_index(UNCOMPRESSED_TIOS_APP);
    if (i>=0) {
    fd.copyfirmware(*current_fw_upg_state.fw_lengths(i)/256+1);
    }

    i = get_firmware_index(COMPRESSED_TIOS_APP);
    if (i>=0) {
        fd.copyfirmwarelzo(YES);
    }

    i = get_firmware_index(UNCOMPRESSED_TIOS);
    if (i>=0) {
        fd.copyfirmware(*current_fw_upg_state.fw_lengths(i)/256+1);
    }

    i = get_firmware_index(TIOS_MON);
    if (i>=0) {
        //fd.copymonitor()
    }

    sys.reboot();
}


string web_get_url_params(string *http_req_string, string *argument) {
string web_get_url_params;
    unsigned char x, y;
    x == instr(1,*http_req_string,*argument+"=",1);
    if ((x == 0)) {
    web_get_url_params = "";
        return web_get_url_params;
    }
    x == x+len(*argument+"=");
    y = instr(x,*http_req_string,"&",1);
    if ((y == 0)) {
        y = instr(x,*http_req_string," ",1);
        if ((y == 0)) {
            y == len(*argument+"=");
        }
    }
    web_get_url_params = mid(*http_req_string,x,y-x);
    return web_get_url_params;
}

void callback_tbl_error(en_tbl_status_codes status) {

}


no_yes callback_tbl_fail_to_open(string *filename, pl_fd_status_codes status, unsigned char filenum) {
no_yes callback_tbl_fail_to_open;

return callback_tbl_fail_to_open;
}


void callback_tbl_field_error(string *file_name, string *field_name, en_tbl_status_codes tbl_result) {

}


void callback_tbl_modified(string *file_name, en_tbl_modified_operation modified_operation) {

}


en_tbl_status_codes tbl_record_find_sorted(en_tbl_record_states record_type, string *search_data, string *field_name, unsigned int *rec_num, bool wraparound, pl_fd_find_modes find_method) {
en_tbl_status_codes tbl_record_find_sorted;
    //If the search includes the records that are marked as deleted.
    //Searching criteria data.
    //Searching criteria name.
    //Starting record number, also returns the first found record number
    //Wrap around
    //find method (equal, greater, lesser, etc.)

    *rec_num = 1;
    bool should_exit = false;
    unsigned int num_records = 0;
    unsigned int count = 0;
    long min = 2147483647;
    long max = -2147483648;
    tbl_get_num_records(num_records,no);
    if (num_records == 0) {
        *rec_num = 0;
        return tbl_record_find_sorted;
    }

    long diff = 2147483647;
    unsigned int best_match = 0;
    unsigned int tmp_diff = 65535;
    char multiplier = 1;
    float search_val = lval(*search_data);
    unsigned int first = 0;
    unsigned int last = 0;
    float current_val;
    switch (find_method) {
    case PL_FD_FIND_GREATER:
case PL_FD_FIND_GREATER_EQUAL:

        multiplier = -1;
        break;
    case PL_FD_FIND_LESSER:
case PL_FD_FIND_LESSER_EQUAL:

        multiplier = 1;
        break;
    }
    best_match = 0;
    count = 0;
    unsigned int tmp_rec = 0;
    while (should_exit == false) {
        tmp_rec = tmp_rec+1;
        *rec_num = tmp_rec;
        tbl_record_find(EN_TBL_RECORD_ACTIVE,*search_data,*field_name,*rec_num,EN_TBL_SEARCH_DOWN,find_method);
        if (*rec_num == 0) {
            tbl_record_sg(tmp_rec,EN_TBL_GET);
        } else {
            tbl_record_sg(*rec_num,EN_TBL_GET);
            current_val = lval(tbl_field_get(*field_name));
            tmp_diff = multiplier*(search_val-current_val);
            if (tmp_diff<diff) {
                best_match = *rec_num;
                diff = tmp_diff;
            }
        }
        current_val = lval(tbl_field_get(*field_name));
        if (current_val>max) {
            max = current_val;
            last = tmp_rec;
        }
        if (current_val<min) {
            min = current_val;
            first = tmp_rec;
        }

        count = count+1;
        if (count == num_records) {
            should_exit = true;
        }
    }
    if (wraparound == true && best_match == 0) {
        switch (find_method) {
        case PL_FD_FIND_GREATER:
case PL_FD_FIND_GREATER_EQUAL:

            best_match = first;
            break;
        case PL_FD_FIND_LESSER:
case PL_FD_FIND_LESSER_EQUAL:

            best_match = last;
            break;
        }
    }
    *rec_num = best_match;
    return tbl_record_find_sorted;
}
