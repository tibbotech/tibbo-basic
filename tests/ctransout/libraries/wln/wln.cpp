//***********************************************************************************************************
//			WI-FI LIBRARY
//			(Works with GA1000)
//***********************************************************************************************************

//##################################################

#include "global.th"

//------------------------------------------------------------------------------
#define WLN_BUFFER_PAGES 5
#define WLN_INIT_SIGNATURE 0x1B2C
#define WLN_SOCK_GET_SIGNATURE_WPA "WWPA"
#define WLN_ASSOCIATION_HOLDOFF_CONST 6//waiting time in (0.5 sec intervals) until we will try to scan/associate again
#define WLN_STAMP "WLN> "
#define WLN_CR_LF chr(13)+chr(10)

bool wln_connect_enabled = true;

#if PLATFORM_ID  ==  WM2000
#define WLN_REQ_BUFFERS 0
#else 
#define WLN_REQ_BUFFERS 1
#endif 

#if GA1000

	#define WLN_FIRMWARE_FILE "ga1000fw.bin"
	#define WLN_SOCK_GET_SIGNATURE_KAL "WKAL"
	#define SHA1_MAC_LEN 20
	#define LABEL1 "Pairwise key expansion"+chr(0x0)
	#define IEEE802_1X_TYPE_EAPOL_KEY 3
	#define WPA_HEADER chr(1)+chr(IEEE802_1X_TYPE_EAPOL_KEY)
	#define WLN_WPA_HANDSHAKE_TIMEOUT 20
	#define NULL_64 chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)
	#define NULL_32 chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)
	#define NULL_16 chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)+chr(0)
	#define NULL_2 chr(0)+chr(0)
	#define CH36_64 chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)+chr(54)
	#define CH5C_64 chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)+chr(92)
	#define CYPHER_TKIP chr(0x00)+chr(0x0F)+chr(0xAC)+chr(0x02)
	#define CYPHER_AES chr(0x00)+chr(0x0F)+chr(0xAC)+chr(0x04)

//------------------------------------------------------------------------------
	enum en_wln_wpa_key_types {
		WLN_WPA_KEY_HMAC_MD5_RC4,
		WLN_WPA_KEY_HMAC_SHA1_AES
	};

//------------------------------------------------------------------------------

	void wln_sha1_prf(string *pmk, string *label, string *data1, string *buf, unsigned char buf_len);
	void wln_wpa_pmk_to_ptk(string *pmk, string *label, string *addr1, string *addr2, string *nonce1, string *nonce2, string *ptk);
	void wln_wpa_supplicant_process_1_of_4(string *snonce, string *anonce, string *ptk);
	void wln_hmac_sha1_vector(string *key, string *addr_element, string *mac, unsigned char pos);
	void wln_hmac_md5_vector(string *key, unsigned char num_elem, string *addr_element, string *mac, unsigned char pos);
	string wln_md5_vector(string *key, string *data);
	string wln_sha1_vector(string *key, string *data);
	void wln_wpa_supplicant_send_2_of_4(unsigned char ver, string *key_len, string *replay_counter, string *snonce, string *mic_key);
	bool wln_wpa_supplicant_process_3_of_4(unsigned int key_info, unsigned int ver, string *replay_counter, string *mic_key, string *ptk);
	void wln_wpa_supplicant_send_4_of_4(unsigned int key_info, unsigned int ver, string *replay_counter, string *mic_key);
	void wln_wpa_supplicant_process_1_of_2(unsigned int key_info, string *key_iv, string *ptk, string *gtk);
	void wln_wpa_supplicant_send_2_of_2(unsigned int key_info, unsigned int ver, string *replay_counter, string *mic_key);
	bool wln_aes_unwrap(string *aes_kek, string *aes_cipher, string *aes_plain, unsigned char n);
	string wln_wpa_supplicant_parse_ies(string *key_data);
	void wln_pbkdf2_sha1_f(string *passphrase, string *ssid, unsigned char pass, unsigned int iterations, unsigned char count, string *digest);

#endif

en_wln_status_codes wln_prepare_security(pl_wln_security_modes security_mode, string *key);
ok_ng wln_start_scan();
en_wln_status_codes wln_rescan();
void wln_debug_print_status(en_wln_status_codes status);
void wln_debugprint(string *print_data);


//----------------------------------------------------------------
//Krack Works on being able  to trick us to reinstall the same key protentially resetting the encryption engine
//We avoid this by only setting the key once during the 3rd step of the handshake
//We avoid this by only setting the group key if the replay counter is larger then the last one' 
string<8> last_replay_counter;
bool wpa_should_set_key;
unsigned char zero_replay_count_data[8];

//------------------------------------------------------------------------------
pl_wln_security_modes wln_security_mode;
string<32> wln_key;

#if WLN_KEEP_ALIVE
	unsigned char wln_keep_alive_tmr;
	unsigned char wln_keep_alive_socket;
	unsigned int wln_keep_alive_ctr;
#endif

	unsigned char wln_wpa_socket;
	string<6> wln_mac_binary;
	string<6> wln_bssid_binary;
	pl_wln_wpa_modes wpa_mode;
	string<32> wln_ap_name;
	no_yes wln_scan_and_assoc_in_prog;
	unsigned int wln_init_flag;
	pl_wln_check_association_retval wln_associated;

#if GA1000
	#if WLN_WPA
		en_wln_wpa_key_types wln_wpa_key_type;
		string<16> wln_mic_key;
		string<64> wln_g_ptk;
		string<16> wln_g_key_iv;
		unsigned char wln_wpa_handshake_timer;
		unsigned char wln_g_group_cipher;
	#endif
#endif

#if WLN_DEBUG_PRINT
	no_yes wln_dont_print_stop;
#endif

no_yes wln_rescan_in_prog;
unsigned char wln_association_holdoff_timer;
no_yes wln_rescan_requested;
no_yes wln_updaterssi_requested;
no_yes wln_active_scan;
pl_wln_module_types wln_module_type;
unsigned char wln_rescan_tmr;
//==============================================================================
string wln_get_info(wln_info_elements info_element, string *extra_data) {
string wln_get_info;
//Returns library-specific information for the requested info element
	pl_wln_security_modes security_mode;
	unsigned char x;

	wln_get_info = "";
	security_mode = val(*extra_data);
	switch (info_element) {
	case WLN_INFO_ELEMENT_REQUIRED_BUFFERS:

		x = WLN_BUFFER_PAGES;

		#if WLN_KEEP_ALIVE
			x = x+1;
		#endif

		#if WLN_WPA
			if (security_mode == WLN_SECURITY_MODE_WPA1 || security_mode == WLN_SECURITY_MODE_WPA2) {
				x = x+2;
			}
		#endif
		wln_get_info = str(x);
		break;

	}
	return wln_get_info;
}

//--------------------------------------------------------------------
en_wln_status_codes wln_start(string *ap_name, pl_wln_security_modes security_mode, string *key, pl_wln_domains domain, no_yes active_scan, pl_wln_scan_filter scanfilter) {
en_wln_status_codes wln_start;
	unsigned char x;

	#if PLATFORM_ID  ==  WM2000
		if (wln.autoconnect == YES) {
			wln_start = WLN_STATUS_AUTOCONNECT;
			goto wln_start_error;
		}

	#endif 

	#if GA1000
		zero_replay_count_data[0] = 0;
		zero_replay_count_data[1] = 0;
		zero_replay_count_data[2] = 0;
		zero_replay_count_data[3] = 0;
		zero_replay_count_data[4] = 0;
		zero_replay_count_data[5] = 0;
		zero_replay_count_data[6] = 0;
		zero_replay_count_data[7] = 1;
	#endif

	if (wln_init_flag != WLN_INIT_SIGNATURE) {
		wln_init();
		wln_init_flag = WLN_INIT_SIGNATURE;
	}

	wln_start = WLN_STATUS_OK;
	wln_rescan_tmr = 0;
	wln_ap_name = *ap_name;
	wln_security_mode = security_mode;
	wln_key = *key;
	wln_active_scan = active_scan;
	wln.scanfilter = scanfilter;

	if (wln.enabled == YES) {
		#if WLN_DEBUG_PRINT
			wln_debugprint("Already started");
		#endif
		return wln_start;
	}

	#if WLN_DEBUG_PRINT
		wln_debugprint("---START---");
	#endif

	wln.domain = domain;

	//obtain necessary sockets
	#if WLN_KEEP_ALIVE
		wln_keep_alive_socket = sock_get(WLN_SOCK_GET_SIGNATURE_KAL);
		if (wln_keep_alive_socket>=sock.numofsock) {
			wln_start = WLN_STATUS_OUT_OF_SOCKETS;
			goto wln_start_error;
		}
	#endif

	#if WLN_WPA && GA1000
		if (security_mode == WLN_SECURITY_MODE_WPA1 || security_mode == WLN_SECURITY_MODE_WPA2) {
			wln_wpa_socket = sock_get(WLN_SOCK_GET_SIGNATURE_WPA);
			if (wln_wpa_socket>=sock.numofsock) {
				wln_start = WLN_STATUS_OUT_OF_SOCKETS;
				goto wln_start_error;
			}
		}
	#endif

	#if PLATFORM_ID != WM2000
	x = wln_get_info(WLN_INFO_ELEMENT_REQUIRED_BUFFERS,str(security_mode));

	if (x>sys.freebuffpages) {
		callback_wln_pre_buffrq(x-sys.freebuffpages);

		if (x>sys.freebuffpages) {
			wln_start = WLN_STATUS_INSUFFICIENT_BUFFER_SPACE;
			goto wln_start_error;
		}
	}
	#endif


	#if WLN_WPA && GA1000
		if (security_mode == WLN_SECURITY_MODE_WPA1 || security_mode == WLN_SECURITY_MODE_WPA2) {
			sock.num = wln_wpa_socket;
			sock.rxbuffrq(1);
			sock.txbuffrq(1);
			sock.protocol = PL_SOCK_PROTOCOL_RAW;
			sock.localportlist = "34958";
			sock.allowedinterfaces = "WLN";
			sock.inconmode = PL_SOCK_INCONMODE_ANY_IP_ANY_PORT;
			sock.reconmode = PL_SOCK_RECONMODE_3;
		}
	#endif

	#if WLN_KEEP_ALIVE
		sock.num = wln_keep_alive_socket;
		sock.txbuffrq(1);
		sock.protocol = PL_SOCK_PROTOCOL_UDP;
		sock.targetport = 65534;
		sock.targetbcast = YES;
		sock.targetip = "255.255.255.255";
		sock.targetinterface = PL_SOCK_INTERFACE_WLN;
		sock.connectiontout = 600;
		wln_keep_alive_tmr = 0;
		wln_keep_alive_ctr = 0;
	#endif

	#if WLN_REQ_BUFFERS
	wln.buffrq(WLN_BUFFER_PAGES);

	sys.buffalloc();
	#endif 
	#if GA1000
		if (wln_module_type == PL_WLN_MODULE_TYPE_GA1000) {
			romfile.open(WLN_FIRMWARE_FILE);
			if (romfile.size == 0) {
				wln_start = WLN_STATUS_MISSING_FIRMWARE_FILE;
				goto wln_start_error;
			}
			if (wln.boot(romfile.offset) != OK) {
				wln_start = WLN_STATUS_BOOT_FAILURE;
				goto wln_start_error;
			}
		} else {
	#endif
	if (wln.boot(0) != OK) {
		wln_start = WLN_STATUS_BOOT_FAILURE;
		goto wln_start_error;
	}

	#if GA1000
		}
	#endif
	#if WLN_WPA
		wln_mac_binary = ddval(wln.mac);
	#endif

	wln_start = wln_prepare_security(security_mode,*key);
	if (wln_start != WLN_STATUS_OK) { goto wln_start_error;}

	wln_association_holdoff_timer = 1;//will start scanning and associating on the next timer event
	return wln_start;

wln_start_error: 
	#if WLN_DEBUG_PRINT
		wln_debug_print_status(wln_start);
		wln_debugprint("---FAILURE---");
	#endif

	#if WLN_DEBUG_PRINT
		wln_dont_print_stop = YES;
	#endif

	wln_stop();

	#if WLN_DEBUG_PRINT
		wln_dont_print_stop = NO;
	#endif
	return wln_start;
}

//----------------------------------------------------------------------------
en_wln_status_codes wln_change(string *ap_name, pl_wln_security_modes security_mode, string *key) {
en_wln_status_codes wln_change;

	if (wln_init_flag != WLN_INIT_SIGNATURE) {
		wln_init();
		wln_init_flag = WLN_INIT_SIGNATURE;
	}

	wln_change = WLN_STATUS_OK;

	#if WLN_DEBUG_PRINT
		wln_debugprint("---CHANGE---");
	#endif

	wln_ap_name = *ap_name;
	wln_security_mode = security_mode;
	wln_key = *key;
	wln_associated = WLN_ASSOCIATION_RETVAL_NO;

	if (wln.enabled == NO) {
		wln_change = WLN_STATUS_NOT_STARTED;
		#if WLN_DEBUG_PRINT
			wln_debugprint("Not yet started");
		#endif
		return wln_change;
	}

	if (wln.task != PL_WLN_TASK_IDLE) {
		wln_change = WLN_STATUS_BUSY;
		#if WLN_DEBUG_PRINT
			wln_debugprint("WLN library is busy and this call can't be executed at this time.");
		#endif
		return wln_change;
	}

	if (wln_prepare_security(security_mode,*key) != WLN_STATUS_OK) { goto wln_change_error;}

	wln.disassociate;
	return wln_change;

wln_change_error: 
	#if WLN_DEBUG_PRINT
		wln_debug_print_status(wln_change);
		wln_debugprint("---FAILURE---");
	#endif

	#if WLN_DEBUG_PRINT
		wln_dont_print_stop = YES;
	#endif

	wln_stop();

	#if WLN_DEBUG_PRINT
		wln_dont_print_stop = NO;
	#endif
	return wln_change;
}

//----------------------------------------------------------------------------
void wln_stop() {
	unsigned int i;

	if (wln_init_flag != WLN_INIT_SIGNATURE) {
		wln_init();
		wln_init_flag = WLN_INIT_SIGNATURE;
	}

	#if WLN_DEBUG_PRINT
		if (wln_dont_print_stop == NO) {
			wln_debugprint("---STOP---");
		}
	#endif

	//just in case something was going on
	while (wln.task != PL_WLN_TASK_IDLE) {
	}

	wln_scan_and_assoc_in_prog = NO;
	wln_associated = WLN_ASSOCIATION_RETVAL_NO;
	wln.disable();
	while (wln.enabled == YES) {
	}
	wln_reset();

	//deallocate buffers and release sockets
	#if WLN_KEEP_ALIVE
		if (wln_keep_alive_socket<sock.numofsock) {
			sock.num = wln_keep_alive_socket;
			sock.discard();

			i = sys.timercount;
wait_close_kal_socket: 
			if (sock.statesimple != PL_SSTS_CLOSED && sys.timercount-i<3 && sys.timercount>=i) {
			goto wait_close_kal_socket;
			}

			sock_release(sock.num);
			wln_keep_alive_socket = 255;

			sock.txbuffrq(0);
		}
	#endif

	#if GA1000
		#if WLN_WPA
			if (wln.getmoduletype()) {
				if (wln_wpa_socket<sock.numofsock) {
					sock.num = wln_wpa_socket;
					sock.discard();

					i = sys.timercount;
	wait_close_wpa_socket: 
					if (sock.statesimple != PL_SSTS_CLOSED && sys.timercount-i<3 && sys.timercount>=i) {
					goto wait_close_wpa_socket;
					}

					sock_release(sock.num);
					wln_wpa_socket = 255;

					sock.rxbuffrq(0);
					sock.txbuffrq(0);
				}
			}
		#endif	
	#endif	

	#if WLN_REQ_BUFFERS
	wln.buffrq(0);
	sys.buffalloc();
	#endif
}

//----------------------------------------------------------------------------
en_wln_status_codes wln_rescan() {
en_wln_status_codes wln_rescan;

	if (wln_init_flag != WLN_INIT_SIGNATURE) {
		wln_init();
		wln_init_flag = WLN_INIT_SIGNATURE;
	}

	wln_rescan = WLN_STATUS_OK;

	#if WLN_DEBUG_PRINT
		if (wln_active_scan == NO) {
			wln_debugprint("---PASSIVE RESCAN---");
		} else {
			wln_debugprint("---ACTIVE RESCAN---");
		}
	#endif

	if (wln.enabled == NO) {
		wln_rescan = WLN_STATUS_NOT_STARTED;
		#if WLN_DEBUG_PRINT
			wln_debugprint("Not yet started");
		#endif
		return wln_rescan;
	}

	if (wln.task != PL_WLN_TASK_IDLE) {
		wln_rescan = WLN_STATUS_BUSY;
		#if WLN_DEBUG_PRINT
			wln_debugprint("WLN library is busy and this call can't be executed at this time.");
		#endif
		return wln_rescan;
	}

	if (wln_active_scan == NO) {
		wln.scan(wln_ap_name);
	} else {
		wln.activescan(wln_ap_name);
	}

	wln_rescan_in_prog = YES;
	return wln_rescan;
}

#if SYS_VER  ==  1000  || PLATFORM_ID == EM500W 
//----------------------------------------------------------------------------
void wln_delay_ms(unsigned long ms) {
	unsigned long delay = ms*3;
	while (delay>0) {
			delay = delay-1;
	}
}

#else

//----------------------------------------------------------------------------
void wln_delay_ms(unsigned long ms) {
	unsigned long delay;
    delay = sys.timercountms;
    if (delay+ms<delay) {
        delay = delay+ms;
        while (sys.timercountms<delay) {
	    }
    } else {
        while (sys.timercountms-delay<ms) {
	    }
    }

}

#endif 

//-----------------------------------------------------------------------------
void wln_start_rescan() {
	wln_rescan_requested = YES;
}

//----------------------------------------------------------------------------
void wln_update_rssi() {
	wln_updaterssi_requested = YES;
}

//----------------------------------------------------------------------------
pl_wln_check_association_retval wln_check_association() {
pl_wln_check_association_retval wln_check_association;
	wln_check_association = wln_associated;
	return wln_check_association;
}

//----------------------------------------------------------------------------
void wln_proc_timer() {
	en_wln_status_codes wln_result;

	if (wln_init_flag != WLN_INIT_SIGNATURE || wln.enabled == NO) {
		return;
	}

	if (wln_connect_enabled != true) {
		return;
	}

	if (wln.associationstate == PL_WLN_NOT_ASSOCIATED) {
		if (wln_scan_and_assoc_in_prog == NO) {
			if (wln_association_holdoff_timer>0) {
				wln_association_holdoff_timer = wln_association_holdoff_timer-1;
				if (wln_association_holdoff_timer == 0) {
					wln_start_scan();
					wln_association_holdoff_timer = WLN_ASSOCIATION_HOLDOFF_CONST;
				}
			}
		}
	}

	if (wln_associated == WLN_ASSOCIATION_RETVAL_YES) {
		if (wln.task == PL_WLN_TASK_IDLE) {
			if (wln_rescan_requested != NO) {
				wln_rescan();
				wln_rescan_requested = NO;
			} else if (wln_updaterssi_requested != NO) {
				//wln.updaterssi()
				wln_updaterssi_requested = NO;
			}
		}
	}

	if (wln_associated == WLN_ASSOCIATION_RETVAL_YES) {
		#if WLN_KEEP_ALIVE
			if (wln_keep_alive_tmr>0) {
				wln_keep_alive_tmr = wln_keep_alive_tmr-1;
				if (wln_keep_alive_tmr == 0) {
					sock.num = wln_keep_alive_socket;
					if (sock.statesimple == PL_SSTS_CLOSED) {
						sock.connect();
						while (sock.statesimple != PL_SSTS_EST) {
						}
					}
					sock.setdata("WLN KEEPALIVE FOR MAC="+wln.mac+" (msg #"+str(wln_keep_alive_ctr)+")");
					sock.send();
					wln_keep_alive_tmr = WLN_KEEP_ALIVE_TOUT;
					#if WLN_DEBUG_PRINT
						wln_debugprint("TX keepalive #"+str(wln_keep_alive_ctr));
					#endif
					wln_keep_alive_ctr = wln_keep_alive_ctr+1;
				}
			}
		#endif	
	} else {
	#if GA1000
		#if WLN_WPA
			if (wln.getmoduletype()) {
				if (wln.associationstate == PL_WLN_ASSOCIATED) {
					if (wln_wpa_handshake_timer>0) {
						wln_wpa_handshake_timer = wln_wpa_handshake_timer-1;
						if (wln_wpa_handshake_timer == 0) {
							if (wln.disassociate() != ACCEPTED) {
								wln_scan_and_assoc_in_prog = NO;
								wln_result = WLN_STATUS_UNEXPECTED_ERROR;
								#if WLN_DEBUG_PRINT
									wln_debug_print_status(wln_result);
								#endif
							}
						}
					}
				}
			}
		#endif
	#endif
	}
}

//----------------------------------------------------------------------------
#if GA1000
	#if WLN_WPA
		int compare_replay_counters(string *replay_counter1, string *replay_counter2) {
int compare_replay_counters;

		int i;
		int result;

		result = 0;

		for (i=1; i <= 8; i++) {
			string rc1 = mid(*replay_counter1,i,1);
			string rc2 = mid(*replay_counter2,i,1);
			if (rc1>rc2) {
				compare_replay_counters = 1;
				break;
			} else if (rc1<rc2) {
				compare_replay_counters = -1;
				break;
			} else {
				compare_replay_counters = 0;
			}
		}

return compare_replay_counters;
		}
	#endif 

//----------------------------------------------------------------------------
void wln_proc_data() {
#if WLN_WPA
	if (wln.getmoduletype()) {
		string rx_data;
		string<32> anonce, snonce, gtk;
		unsigned char ver, x;
		string<2> key_len;
		string<8> replay_counter;
		string<16> ptk_kek;
		unsigned int key_info, keydatalen;
		string plain;
		string<128> encrypt_key;
		string<34> kde_gtk;
		string<32> wpakey;
		string<8> stemp1, stemp2;

		if (mid(wln.scanresultwpainfo,7,4) == CYPHER_TKIP) {
			wln_g_group_cipher = PL_WLN_WPA_ALGORITHM_TKIP;
		}

		if (mid(wln.scanresultwpainfo,7,4) == CYPHER_AES) {
			wln_g_group_cipher = PL_WLN_WPA_ALGORITHM_AES;
		}

		if (wln_init_flag != WLN_INIT_SIGNATURE || sock.num != wln_wpa_socket) {
			return;
		}

		rx_data = sock.getdata(255);

		//packet type should be "3" (EAPOL-Key)
		stemp1 = mid(rx_data,2,1);
		if (asc(stemp1) != 3) {
			return;
		}

		//descriptor type must be 254 - RSN Key Descriptor
		stemp1 = mid(rx_data,5,1);
		stemp2 = mid(rx_data,5,1);
		if (asc(stemp1) != 254 && asc(stemp2) != 2) {
			return;
		}
		//check key information
		stemp1 = mid(rx_data,6,1);
		stemp2 = mid(rx_data,7,1);
		key_info = asc(stemp1)*256+asc(stemp2);
		if ((key_info && 1) != 0) {
			wln_wpa_key_type = WLN_WPA_KEY_HMAC_MD5_RC4;
		} else if ((key_info && 2) != 0) {
			wln_wpa_key_type = WLN_WPA_KEY_HMAC_SHA1_AES;
		} else {
			//unsupported
		}

		//bit 7 or 13 must be set
		if ((key_info && 0x80) == 0 && (key_info && 0x2000) == 0) {
			return;
		}

		//bit 0-2 of key_info is key descriptor version

		ver = (key_info & &b111);

		//byte 8,9 is key length
		key_len = mid(rx_data,8,2);

		//byte 10 to 17 is replay_counter
		replay_counter = mid(rx_data,10,8);


		//Need to ensure the replay counter is increasing
		if (compare_replay_counters(replay_counter,last_replay_counter)>0) {

			if (wln_security_mode == WLN_SECURITY_MODE_WPA2 && (key_info && 0x1000) != 0) {
				stemp1 = mid(rx_data,98,1);
				stemp2 = mid(rx_data,99,1);
				keydatalen = asc(stemp1)*256+asc(stemp2);
				if (ver == 2) {
					if ((keydatalen % 8) != 0) {
						return;
					}
					keydatalen = keydatalen-8;
					ptk_kek = mid(wln_g_ptk,17,16);
					x = len(rx_data);
					encrypt_key = mid(rx_data,100,x-99);
					if (wln_aes_unwrap(ptk_kek,encrypt_key,plain,keydatalen/8) == false) {
						return;
				}
				insert(rx_data,98,chr(keydatalen/256));
				insert(rx_data,99,chr(keydatalen % 256));
			}
		}

		//for bit 3, 1=Pairwise, 0=Group key
		if ((key_info && 0x8) != 0) {
			if ((key_info && 0x100) != 0) {
				kde_gtk = wln_wpa_supplicant_parse_ies(plain);
				#if WLN_DEBUG_PRINT
					wln_debugprint("Pairwise step 3/4");
				#endif			
				bool key_was_set;
				key_was_set = wln_wpa_supplicant_process_3_of_4(key_info,ver,replay_counter,wln_mic_key,wln_g_ptk);
				if (key_was_set && kde_gtk != "") {
					if ((wln_g_group_cipher != PL_WLN_WPA_ALGORITHM_TKIP)) {
						wpakey = right(kde_gtk,16);
						wln.setwpa(wpa_mode,PL_WLN_WPA_ALGORITHM_AES,wpakey,PL_WLN_WPA_CAST_MULTICAST);
					} else {
						wpakey = right(kde_gtk,32);
						stemp1 = mid(wpakey,17,8);
						stemp2 = mid(wpakey,25,8);
						insert(wpakey,17,stemp2);
						insert(wpakey,25,stemp1);
						wln.setwpa(wpa_mode,PL_WLN_WPA_ALGORITHM_TKIP,wpakey,PL_WLN_WPA_CAST_MULTICAST);//'<<<<<<<<<<<@@@@@	
					}

					wln_associated = WLN_ASSOCIATION_RETVAL_YES;
					wln_rescan_tmr = WLN_RESCAN_TMR_CTR_CONNECT;
					callback_wln_ok();
					#if WLN_KEEP_ALIVE == 1
						wln_keep_alive_tmr = WLN_KEEP_ALIVE_TOUT;
					#endif
					#if WLN_DEBUG_PRINT
						wln_debugprint("---ASSOCIATED (WPA2-PSK)---");
					#endif				
				}
			} else {
				#if WLN_DEBUG_PRINT
					wln_debugprint("Pairwise step 1/4");
				#endif		
				//''''' Security Issue Fix. This value must always be initialized randomly  
				anonce = mid(rx_data,18,32);
				//''''' Security Issue Fix. This value must always be initialized randomly  
				snonce = random(32);
				wln_wpa_supplicant_process_1_of_4(snonce,anonce,wln_g_ptk);
				wln_mic_key = left(wln_g_ptk,16);
				#if WLN_DEBUG_PRINT
					wln_debugprint("Pairwise step 2/4");
				#endif			
				wln_wpa_supplicant_send_2_of_4(ver,key_len,replay_counter,snonce,wln_mic_key);
			}
		} else {
			if ((key_info && 0x100) != 0) {
				if (wln_security_mode == WLN_SECURITY_MODE_WPA1) {
					wln_g_key_iv = mid(rx_data,50,16);
					gtk = mid(rx_data,100,32);
					ptk_kek = mid(wln_g_ptk,17,16);
				} else {
					kde_gtk = wln_wpa_supplicant_parse_ies(plain);
				}

				#if WLN_DEBUG_PRINT
					wln_debugprint("Group key step 1/2");
				#endif			

				if (wln_security_mode == WLN_SECURITY_MODE_WPA1) {
					wln_wpa_supplicant_process_1_of_2(key_info,wln_g_key_iv,ptk_kek,gtk);
				} else {
					if (kde_gtk != "") {
						if ((wln_g_group_cipher != PL_WLN_WPA_ALGORITHM_TKIP)) {
							wpakey = right(kde_gtk,16);
							wln.setwpa(wpa_mode,PL_WLN_WPA_ALGORITHM_AES,wpakey,PL_WLN_WPA_CAST_MULTICAST);
						} else {
							wpakey = right(kde_gtk,32);
							stemp1 = mid(wpakey,17,8);
							stemp2 = mid(wpakey,25,8);
							insert(wpakey,17,stemp2);
							insert(wpakey,25,stemp1);
							wln.setwpa(wpa_mode,PL_WLN_WPA_ALGORITHM_TKIP,wpakey,PL_WLN_WPA_CAST_MULTICAST);//'<<<<<<<<<<<@@@@@	
						}
					}
				}

				wln_mic_key = left(wln_g_ptk,16);
				#if WLN_DEBUG_PRINT
					wln_debugprint("Group key step 2/2");
				#endif			
				wln_wpa_supplicant_send_2_of_2(key_info,ver,replay_counter,wln_mic_key);

					if (wln_security_mode == WLN_SECURITY_MODE_WPA1) {
					wln_associated = WLN_ASSOCIATION_RETVAL_YES;
					wln_rescan_tmr = WLN_RESCAN_TMR_CTR_CONNECT;
					callback_wln_ok();
				}

					#if WLN_DEBUG_PRINT
					if (wln_security_mode == WLN_SECURITY_MODE_WPA1) {
						wln_debugprint("---ASSOCIATED(WPA1-PSK)---");
					} else {
						wln_debugprint("---GROUP KEY UPDATED(WPA2-PSK)---");
					}
				#endif			
				#if WLN_KEEP_ALIVE == 1
					wln_keep_alive_tmr = WLN_KEEP_ALIVE_TOUT;
				#endif			
			}
		}
		last_replay_counter = replay_counter;
		}
	}
#endif
}
#else 
void wln_proc_data() {
}
#endif
//----------------------------------------------------------------------------
void wln_proc_task_complete(pl_wln_tasks completed_task) {
	en_wln_status_codes wln_result;
	unsigned char current_rssi, scan_rssi;
	no_yes different_ap;

	if (wln_init_flag != WLN_INIT_SIGNATURE || wln.enabled == NO) {
		return;
	}

	wln_result = WLN_STATUS_OK;

	switch (completed_task) {
	case PL_WLN_TASK_SCAN:
case PL_WLN_TASK_ACTIVESCAN:

		if (wln_rescan_in_prog == YES) {
			wln_rescan_in_prog = NO;
			if (wln.associationstate == PL_WLN_NOT_ASSOCIATED) {
				current_rssi = 0;
			} else {
				current_rssi = wln.rssi;
			}

			if (wln.scanresultssid != wln_ap_name) {
				scan_rssi = 0;
			} else {
				scan_rssi = wln.scanresultrssi;
			}

			if (ddval(wln.scanresultbssid) == wln_bssid_binary) {
				different_ap = NO;
			} else {
				different_ap = YES;
			}

			callback_wln_rescan_result(current_rssi,scan_rssi,different_ap);
			return;
		}

		//was looking for AP
		if (instr(1,wln.scanresultssid,wln_ap_name,1) == 0) {
			wln_result = WLN_STATUS_SCANNING_FAILURE;
			goto finish;
		}

		wln_bssid_binary = ddval(wln.scanresultbssid);

		//For WEP mode, security key must be set EACH TIME before the association
		switch (wln_security_mode) {
		case WLN_SECURITY_MODE_WEP64:

			if (wln.setwep(wln_key,PL_WLN_WEP_MODE_64) != ACCEPTED) {
				wln_result = WLN_STATUS_UNEXPECTED_ERROR;
				goto finish;
			}
			break;

		case WLN_SECURITY_MODE_WEP128:

			if (wln.setwep(wln_key,PL_WLN_WEP_MODE_128) != ACCEPTED) {
				wln_result = WLN_STATUS_UNEXPECTED_ERROR;
				goto finish;
			}
			break;

		#if WLN_WPA			
			//WA2000 Note: We need security not to be reset to make the module more responsive. 				
			case WLN_SECURITY_MODE_WPA1:

				if (wln.getmoduletype() || wln.getmoduletype()) {
					if (wln.setwpa(PL_WLN_WPA_WPA1_PSK,PL_WLN_WPA_ALGORITHM_TKIP,wln_key,PL_WLN_WPA_CAST_MULTICAST) != ACCEPTED) {
						wln_result = WLN_STATUS_UNEXPECTED_ERROR;
						goto finish;
					}
				}
				break;
			case WLN_SECURITY_MODE_WPA2:

				if (wln.getmoduletype() || wln.getmoduletype()) {
					if (wln.setwpa(PL_WLN_WPA_WPA2_PSK,PL_WLN_WPA_ALGORITHM_AES,wln_key,PL_WLN_WPA_CAST_MULTICAST) != ACCEPTED) {
						wln_result = WLN_STATUS_UNEXPECTED_ERROR;
						goto finish;
					}
				}
				break;
		#endif		

		default:
			if (wln.setwep("",PL_WLN_WEP_MODE_DISABLED) != ACCEPTED) {
				wln_result = WLN_STATUS_UNEXPECTED_ERROR;
				goto finish;
			}break;
		}

		//start association
		#if WLN_DEBUG_PRINT
			wln_debugprint("ASSOCIATE with "+wln_ap_name+" (bssid: "+wln.scanresultbssid+", ch: "+str(wln.scanresultchannel)+")");
		#endif

		wln_associated = WLN_ASSOCIATION_RETVAL_INPROG;
		callback_wln_starting_association();
		if (wln.associate(wln.scanresultbssid,wln_ap_name,wln.scanresultchannel,wln.scanresultbssmode) != ACCEPTED) {
			wln_result = WLN_STATUS_UNEXPECTED_ERROR;
			goto finish;
		}
		return;
		break;

	case PL_WLN_TASK_ASSOCIATE:

		if (wln.associationstate == PL_WLN_ASSOCIATED) {

			#if WLN_WPA	
				if (wln_security_mode == WLN_SECURITY_MODE_WPA1 || wln_security_mode == WLN_SECURITY_MODE_WPA2) {
                    if (wln.getmoduletype()) {
#if WLN_DEBUG_PRINT
                        //GA1000 Note The handshake timer is only available in WLN_WPA for the GA1000
					    wln_debugprint("Pre-associated for WPA1/2-PSK, starting handshake");
#endif					
#if GA1000
						wln_wpa_handshake_timer = WLN_WPA_HANDSHAKE_TIMEOUT;
#endif
                    } else {
#if WLN_DEBUG_PRINT                        
					    wln_debugprint("---ASSOCIATED(WPA1 or WPA2)---");
#endif                     
                        //WA2000 is already associated at this stage. The wln_associated value is set after wpa for GA1000
                        wln_associated = WLN_ASSOCIATION_RETVAL_YES;
					    callback_wln_ok();
                    }
					goto finish;
				}
			#endif

			#if WLN_KEEP_ALIVE == 1
				wln_keep_alive_tmr = WLN_KEEP_ALIVE_TOUT;
			#endif

			#if WLN_DEBUG_PRINT
				wln_debugprint("---ASSOCIATED(WEP64, WEP128, or no security)---");
			#endif
			wln_associated = WLN_ASSOCIATION_RETVAL_YES;
			wln_rescan_tmr = WLN_RESCAN_TMR_CTR_CONNECT;
			callback_wln_ok();
			goto finish;
		} else {
			wln_result = WLN_STATUS_ASSOCIATION_FAILURE;
			goto finish;
		}
		break;

	case PL_WLN_TASK_DISASSOCIATE:

		wln_result = WLN_STATUS_DISASSOCIATION;
		goto finish;
		break;

	default:
		return;break;
	}

finish: 
	wln_scan_and_assoc_in_prog = NO;
	if (wln_result != WLN_STATUS_OK) {
		#if WLN_DEBUG_PRINT
			wln_debug_print_status(wln_result);
		#endif
		wln_associated = WLN_ASSOCIATION_RETVAL_NO;
		callback_wln_failure(wln_result);
	}
}

//----------------------------------------------------------------------------
void wln_proc_event(pl_wln_events wln_event) {

	if (wln_init_flag != WLN_INIT_SIGNATURE || wln.enabled == NO) {
		return;
	}

	wln_scan_and_assoc_in_prog = NO;
	if (wln_event == PL_WLN_EVENT_DISASSOCIATED) {
		#if WLN_DEBUG_PRINT
			wln_debug_print_status(WLN_STATUS_DISASSOCIATION);
		#endif

		if (wln_associated == WLN_ASSOCIATION_RETVAL_YES) {
			wln_associated = WLN_ASSOCIATION_RETVAL_NO;
			callback_wln_failure(WLN_STATUS_DISASSOCIATION);
		} else {
			callback_wln_failure(WLN_STATUS_ASSOCIATION_FAILURE);//means we've been kicked out during WPA handshake
		}

		last_replay_counter = "\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}


//------------------------------------------------------------------------------
void wln_check_for_better_ap(unsigned char rssi_lvl) {
	unsigned char i;
	unsigned char sock_backup;
	no_yes ongoing_connection;

	sock_backup = sock.num;
	if (wln_check_association() != WLN_ASSOCIATION_RETVAL_YES) {
		wln_rescan_tmr = WLN_RESCAN_TMR_CTR_CONNECT;
	} else {
		//when we are associated...
		if (wln_rescan_tmr>0) {
			wln_rescan_tmr = wln_rescan_tmr-1;
			if (wln_rescan_tmr == 0) {
				ongoing_connection = NO;
				for (i=0; i <= sock.numofsock; i++) {
					sock.num = i;
					if (sock.statesimple == PL_SSTS_EST && sock.currentinterface == PL_SOCK_INTERFACE_WLN) {
						ongoing_connection = YES;
						break;
					}
				}

				if (ongoing_connection == YES) {
					wln_rescan_tmr = WLN_RESCAN_TMR_CTR_CONNECT;
					if (wln.rssi>=rssi_lvl) {
						goto finish;
					} else {
						goto rescan;//if TCP established we rescan only if current signal is weak
					}
				} else {
					wln_rescan_tmr = WLN_RESCAN_TMR_CTR_NO_CONNECT;
rescan: 
					callback_wln_rescan_for_better_ap();
					wln_start_rescan();//if TCP not established we rescan periodically no matter whata
				}
			}
		}
	}
finish: 
	sock.num = sock_backup;
}

//----------------------------------------------------------------------------
ok_ng wln_start_scan() {
ok_ng wln_start_scan;
	accepted_rejected res;

	wln_start_scan = NG;

	if (wln.enabled != YES) { return wln_start_scan;}
	if (wln_scan_and_assoc_in_prog == YES) { return wln_start_scan;}
	if (wln.task != PL_WLN_TASK_IDLE) { return wln_start_scan;}

	if (wln_active_scan == NO) {
		res = wln.scan(wln_ap_name);
	} else {
		res = wln.activescan(wln_ap_name);
	}

	if (res == ACCEPTED) {
		#if WLN_DEBUG_PRINT
			if (wln_active_scan == NO) {
				wln_debugprint("PASSIVE SCAN for "+wln_ap_name);
			} else {
				wln_debugprint("ACTIVE SCAN for "+wln_ap_name);
			}
		#endif
		wln_scan_and_assoc_in_prog = YES;
		wln_start_scan = OK;
	} else {
		#if WLN_DEBUG_PRINT
			wln_debugprint("Wi-Fi is busy, waiting...");
		#endif
		wln_start_scan = NG;
	}
	return wln_start_scan;
}



//----------------------------------------------------------------------------
en_wln_status_codes wln_prepare_security(pl_wln_security_modes security_mode, string *key) {
en_wln_status_codes wln_prepare_security;
	int algorithm;


	wln_prepare_security = WLN_STATUS_OK;

	#if WLN_WPA

		switch (security_mode) {
		case WLN_SECURITY_MODE_WPA1:

			wpa_mode = PL_WLN_WPA_WPA1_PSK;
			algorithm = PL_WLN_WPA_ALGORITHM_TKIP;
			break;
		case WLN_SECURITY_MODE_WPA2:

			wpa_mode = PL_WLN_WPA_WPA2_PSK;
			algorithm = PL_WLN_WPA_ALGORITHM_AES;
			break;
		default:
			wpa_mode = PL_WLN_WPA_DISABLED;break;
		}
		#if WLN_AVAILABLE  ==  1
				wln.setwpa(wpa_mode,0,"",0);
		#endif 

	#else

		wpa_mode = PL_WLN_WPA_DISABLED;
	#endif

	last_replay_counter = "\x00\x00\x00\x00\x00\x00\x00\x00";
	wpa_should_set_key = false;

	switch (security_mode) {
	case WLN_SECURITY_MODE_DISABLED:

	break;
		//---

	#if WLN_WPA
		case WLN_SECURITY_MODE_WPA1:
case WLN_SECURITY_MODE_WPA2:

		break;
			//---
	#endif		

	case WLN_SECURITY_MODE_WEP64:

		if (len(*key) != 10) {
			wln_prepare_security = WLN_STATUS_INVALID_WEP_KEY;
			return wln_prepare_security;
		}
		break;

	case WLN_SECURITY_MODE_WEP128:

		if (len(*key) != 26) {
			wln_prepare_security = WLN_STATUS_INVALID_WEP_KEY;
			return wln_prepare_security;
		}
		break;

	default:
		wln_prepare_security = WLN_STATUS_INVALID_SECURITY_MODE;
		return wln_prepare_security;break;

	}
	return wln_prepare_security;
}

//------------------------------------------------------------------------------

#if WLN_WPA
string wln_wpa_mkey_get(string *password, string *ssid) {
string wln_wpa_mkey_get;
	#if GA1000
	unsigned long count;
	unsigned char pos, plen, left1;
	string<SHA1_MAC_LEN> digest, s;
	string<32> buf;
	unsigned char f;
	buf = "";
	count = 0;
	left1 = 32;
	pos = 1;
	for (f=0; f <= 1; f++) {
		count = count+1;
		wln_pbkdf2_sha1_f(*password,*ssid,f,4096,count,digest);
		if (left1>SHA1_MAC_LEN) {
			plen = SHA1_MAC_LEN;
		} else {
			plen = left1;
		}
		s = left(digest,plen);
		insert(buf,pos,s);
		pos = pos+plen;
		left1 = left1-plen;
	}
	wln_wpa_mkey_get = buf;
	callback_wln_mkey_progress_update(100);
	#else 
	wln_wpa_mkey_get = *password;
	#endif 
	return wln_wpa_mkey_get;
}
#endif

#if GA1000
		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		void wln_wpa_supplicant_process_1_of_4(string *snonce, string *anonce, string *ptk) {
			string<32> addr1, addr2;
			string<8> temp1, temp2;

			addr1 = wln_mac_binary;
			addr2 = wln_bssid_binary;
			wln_wpa_pmk_to_ptk(wln_key,LABEL1,addr1,addr2,*snonce,*anonce,*ptk);

			temp1 = right(*ptk,8);
			temp2 = mid(*ptk,49,8);
			insert(*ptk,49,temp1);
			insert(*ptk,57,temp2);
			wpa_should_set_key = true;
		}
		#endif

		//------------------------------------------------------------------------------
		#if WLN_WPA
		void wln_wpa_pmk_to_ptk(string *pmk, string *label, string *addr1, string *addr2, string *nonce1, string *nonce2, string *ptk) {
			string<128> data1;

			if (*addr1<*addr2) {
				data1 = *addr1+*addr2;
			} else {
				data1 = *addr2+*addr1;
			}

			if (*nonce1<*nonce2) {
				data1 = data1+*nonce1+*nonce2;
			} else {
				data1 = data1+*nonce2+*nonce1;
			}
			wln_sha1_prf(*pmk,*label,data1,*ptk,64);

		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		void wln_sha1_prf(string *pmk, string *label, string *data1, string *buf, unsigned char buf_len) {
			unsigned char len1[3];
			unsigned char counter;
			unsigned char pos, plen;
			string<20> s;
			string s1;

			len1[0] = len(*label);
			len1[1] = len(*data1);
			len1[2] = 1;

			pos = 1;
			counter = 0;

			while (pos<buf_len) {
				s1 = *label+*data1+chr(counter);
				plen = buf_len-pos+1;
				if (plen>=SHA1_MAC_LEN) {
					wln_hmac_sha1_vector(*pmk,s1,*buf,pos);
					pos = pos+SHA1_MAC_LEN;
				} else {
					wln_hmac_sha1_vector(*pmk,s1,s,0);
					s = left(s,plen);
					insert(*buf,pos,s);
					return;
				}
				counter = counter+1;
			}
		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		void wln_hmac_sha1_vector(string *key, string *addr_element, string *mac, unsigned char pos) {

			string<64> k_pad, stemp, null_str;
			string<20> tk1, tk2;
			unsigned char l;

			l = 64-len(*key);
			null_str = left(NULL_64,l);
			k_pad = *key+null_str;

			stemp = CH36_64;
			k_pad = strxor(k_pad,stemp);

			tk1 = wln_sha1_vector(k_pad,*addr_element);

			k_pad = *key+null_str;


			stemp = CH5C_64;
			k_pad = strxor(k_pad,stemp);

			tk2 = wln_sha1_vector(k_pad,tk1);
			insert(*mac,pos,tk2);
		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		string wln_sha1_vector(string *key, string *data) {
string wln_sha1_vector;

			string s;
			string hash;
			unsigned char l;

			s = *key;
			l = len(s);
			hash = sha1(s,"",SHA1_UPDATE,0);

			s = *data;
			l = l+len(s);
			hash = sha1(s,hash,SHA1_FINISH,l);

			wln_sha1_vector = hash;
			return wln_sha1_vector;
		}

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		void wln_wpa_supplicant_send_2_of_4(unsigned char ver, string *key_len, string *replay_counter, string *snonce, string *mic_key) {
			unsigned int length;
			unsigned char lsb, msb;
			string reply;
			unsigned int key_info;
			string<16> mac;
			string<32> stemp;
			unsigned char mac_pos;
			string<1> info_header, info_length;
			string<96> scanresultwpainfo;


			//header(4)
			scanresultwpainfo = wln.scanresultwpainfo;

			length = len(scanresultwpainfo)-2+95;
			msb = length/256;
			lsb = length % 256;

			reply = WPA_HEADER+chr(msb)+chr(lsb);

			//key_type(1)
			if (wln_security_mode == WLN_SECURITY_MODE_WPA1) {
				reply = reply+chr(0xFE);

			} else {
				reply = reply+chr(0x2);
			}

			//key_info(2)
			key_info = ver+0x8+0x100;
			msb = key_info/256;
			lsb = key_info % 256;
			reply = reply+chr(msb)+chr(lsb);

			//key_length(2)
			reply = reply+*key_len;

			//replay_counter(8)
			reply = reply+*replay_counter;

			//key_nonce(32)
			reply = reply+*snonce;

			//key_iv(16), key_rsc(8), key_id(8)
			stemp = NULL_32;
			reply = reply+stemp;

			//mac(16)
			mac_pos = len(reply)+1;
			mac = NULL_16;
			reply = reply+mac;

			//key_data_length(2)
			length = len(scanresultwpainfo)-2;
			msb = length/256;
			lsb = length % 256;
			reply = reply+chr(msb)+chr(lsb);

			//WPA info
			info_header = left(scanresultwpainfo,1);
			info_length = mid(scanresultwpainfo,3,1);
			reply = reply+info_header+info_length+mid(scanresultwpainfo,5,asc(info_length));


			//overwrite mac (82 to 98)
			if (ver == 1) {
				wln_hmac_md5_vector(*mic_key,1,reply,mac,0);
			} else {
				wln_hmac_sha1_vector(*mic_key,reply,mac,0);
			}
			length = len(reply);
			stemp = right(reply,length-mac_pos-16+1);
			reply = left(reply,mac_pos-1);
			reply = reply+left(mac,16)+stemp;

			sock.setdata(reply);
			sock.send();
		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		void wln_hmac_md5_vector(string *key, unsigned char num_elem, string *addr_element, string *mac, unsigned char pos) {
			string<64> k_pad, stemp, null_str;
			string<20> tk1, tk2;
			unsigned char l;

			l = 64-len(*key);
			null_str = left(NULL_64,l);
			k_pad = *key+null_str;

			stemp = CH36_64;
			k_pad = strxor(k_pad,stemp);

			tk1 = wln_md5_vector(k_pad,*addr_element);
			k_pad = *key+null_str;

			stemp = CH5C_64;
			k_pad = strxor(k_pad,stemp);

			tk2 = wln_md5_vector(k_pad,tk1);
			insert(*mac,pos,tk2);
		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		string wln_md5_vector(string *key, string *data) {
string wln_md5_vector;
			string<16> hash;
			unsigned char l;

			l = len(*key);
			hash = md5(*key,"",MD5_UPDATE,0);

			l = l+len(*data);
			hash = md5(*data,hash,MD5_FINISH,l);

			wln_md5_vector = hash;
			return wln_md5_vector;
		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		bool wln_wpa_supplicant_process_3_of_4(unsigned int key_info, unsigned int ver, string *replay_counter, string *mic_key, string *ptk) {
bool wln_wpa_supplicant_process_3_of_4;
			string<32> s;
			bool key_was_set;
			key_was_set = false;

			*mic_key = left(*ptk,16);
			#if WLN_DEBUG_PRINT
				wln_debugprint("Pairwise step 4/4");
			#endif	
			wln_wpa_supplicant_send_4_of_4(key_info,ver,*replay_counter,*mic_key);
			if ((key_info && 0x40) != 0) {
				if (wln_security_mode == WLN_SECURITY_MODE_WPA1) {
					s = right(*ptk,32);
					wln.setwpa(wpa_mode,PL_WLN_WPA_ALGORITHM_TKIP,s,PL_WLN_WPA_CAST_UNICAST);
				} else {

					//--------------------------------------------------------------------------------
					//Fix #1 for Krack attack. Ensure the key is only installed once. 
					if (wpa_should_set_key == true) {
					s = mid(*ptk,33,16);
					wln.setwpa(wpa_mode,PL_WLN_WPA_ALGORITHM_AES,s,PL_WLN_WPA_CAST_UNICAST);
						wpa_should_set_key = false;
						key_was_set = true;
				}
			}
			}

			wln_wpa_supplicant_process_3_of_4 = key_was_set;
			return wln_wpa_supplicant_process_3_of_4;
		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		void wln_wpa_supplicant_send_4_of_4(unsigned int key_info, unsigned int ver, string *replay_counter, string *mic_key) {
			unsigned int length;
			unsigned char lsb, msb;
			string reply;
			string<16> mac;
			string<32> stemp;
			unsigned char mac_pos;

			//header(4)
			length = 95;
			msb = length/256;
			lsb = length % 256;
			reply = WPA_HEADER+chr(msb)+chr(lsb);

			//key_type(1)
			if (wln_security_mode == WLN_SECURITY_MODE_WPA1) {
				reply = reply+chr(0xFE);
			} else {
				reply = reply+chr(0x02);
			}

			//key_info(2)
			key_info = key_info & 0x200;
			key_info = key_info+ver+0x8+0x100;
			msb = key_info/256;
			lsb = key_info % 256;
			reply = reply+chr(msb)+chr(lsb);

			//key_length(2)
			reply = reply+NULL_2;

			//replay_counter(8)
			reply = reply+*replay_counter;

			//key_nonce(32)
			stemp = NULL_32;
			reply = reply+stemp;

			//key_iv(16), key_rsc(8), key_id(8)
			stemp = NULL_32;
			reply = reply+stemp;

			//mac(16)
			mac_pos = len(reply)+1;
			mac = NULL_16;
			reply = reply+mac;

			//key_data_length(2)
			reply = reply+NULL_2;

			//overwrite mac
			if (ver == 1) {
				wln_hmac_md5_vector(*mic_key,1,reply,mac,0);
			} else {
				wln_hmac_sha1_vector(*mic_key,reply,mac,0);
			}
			length = len(reply);
			stemp = right(reply,length-mac_pos-16+1);
			reply = left(reply,mac_pos-1);
			reply = reply+left(mac,16)+stemp;

			sock.setdata(reply);
			sock.send();
		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		void wln_wpa_supplicant_process_1_of_2(unsigned int key_info, string *key_iv, string *ptk, string *gtk) {
			unsigned char gd_keyidx;
			string<32> ek;
			string<8> stemp1, stemp2;

			gd_keyidx = key_info & 0x30;
			gd_keyidx = gd_keyidx/0x10;

			ek = left(*key_iv,16)+right(*ptk,16);

			*gtk = rc4(ek,256,*gtk);

			stemp1 = mid(*gtk,17,8);
			stemp2 = mid(*gtk,25,8);
			insert(*gtk,17,stemp2);
			insert(*gtk,25,stemp1);

			wln.setwpa(wpa_mode,PL_WLN_WPA_ALGORITHM_TKIP,*gtk,PL_WLN_WPA_CAST_MULTICAST);
		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		void wln_wpa_supplicant_send_2_of_2(unsigned int key_info, unsigned int ver, string *replay_counter, string *mic_key) {
			unsigned int length;
			unsigned char lsb, msb;
			string reply;
			string<16> mac;
			string<32> stemp;
			unsigned char mac_pos;

			//header(4)
			length = 95;
			msb = length/256;
			lsb = length % 256;
			reply = chr(0x1)+chr(IEEE802_1X_TYPE_EAPOL_KEY)+chr(msb)+chr(lsb);

			//key_type(1)
			if (wln_security_mode == WLN_SECURITY_MODE_WPA1) {
				reply = reply+chr(0xFE);
			} else {
				reply = reply+chr(0x02);
			}


			//key_info(2)
			key_info = key_info & 0x30;
			key_info = key_info+ver+0x200+0x100;
			msb = key_info/256;
			lsb = key_info % 256;
			reply = reply+chr(msb)+chr(lsb);

			//key_length(2)
			reply = reply+NULL_2;

			//replay_counter(8)
			reply = reply+*replay_counter;

			//key_nonce(32)
			stemp = NULL_32;
			reply = reply+stemp;

			//key_iv(16), key_rsc(8), key_id(8)
			stemp = NULL_32;
			reply = reply+stemp;

			//mac(16)
			mac_pos = len(reply)+1;
			mac = NULL_16;
			reply = reply+mac;

			//key_data_length(2)
			reply = reply+NULL_2;

			//overwrite mac
			if (ver == 1) {
				wln_hmac_md5_vector(*mic_key,1,reply,mac,0);
			} else {
				wln_hmac_sha1_vector(*mic_key,reply,mac,0);
			}
			length = len(reply);
			stemp = right(reply,length-mac_pos-16+1);
			reply = left(reply,mac_pos-1);
			reply = reply+mac+stemp;

			sock.setdata(reply);
			sock.send();
		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		bool wln_aes_unwrap(string *aes_kek, string *aes_cipher, string *aes_plain, unsigned char n) {
bool wln_aes_unwrap;
			string<8> a;
			string<16> b;
			unsigned char r, k, l, i, j;

			a = left(*aes_cipher,8);
			insert(*aes_plain,1,mid(*aes_cipher,9,8*n));

			j = 6;
			while (j>0) {
				j = j-1;
				r = (n-1)*8;
				i = n+1;
				while (i>1) {
					i = i-1;
					b = a;
					k = n*j+i;
					l = asc(mid(b,8,1));
					k = k ^ l;
					insert(b,8,chr(k));
					insert(b,9,mid(*aes_plain,r+1,8));
					b = aes128dec(*aes_kek,b);
					a = left(b,8);
					insert(*aes_plain,r+1,right(b,8));
					r = r-8;
				}
			}

			for (i=0; i <= 7; i++) {
				if (mid(a,i,1) != chr(0xa6)) {
					wln_aes_unwrap = false;
					return wln_aes_unwrap;
				}
			}
			wln_aes_unwrap = true;
			return wln_aes_unwrap;
		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		string wln_wpa_supplicant_parse_ies(string *key_data) {
string wln_wpa_supplicant_parse_ies;
			unsigned char pos, data_len;
			string<1> header;
			string<4> rsn_group_key_data;

			pos = 0;
			data_len = 0;
			do {
				data_len = asc(mid(*key_data,pos+2,1));
				header = mid(*key_data,pos+1,1);

				if (data_len == 0 && header == chr(0xdd)) { break;}
				if (header == chr(0xdd)) {
					rsn_group_key_data = mid(*key_data,pos+3,4);
					if (data_len>4 && rsn_group_key_data == chr(0x00)+chr(0x0F)+chr(0xAC)+chr(0x01)) {
						wln_wpa_supplicant_parse_ies = mid(*key_data,pos+7,data_len-4);
						return wln_wpa_supplicant_parse_ies;
					}
				}

				pos = pos+data_len+2;
				if (pos>=len(*key_data)) { break;}
			} while (true);
			wln_wpa_supplicant_parse_ies = "";
			return wln_wpa_supplicant_parse_ies;
		}
		#endif

		//--------------------------------------------------------------------------------------------- 
		#if WLN_WPA
		void wln_pbkdf2_sha1_f(string *passphrase, string *ssid, unsigned char pass, unsigned int iterations, unsigned char count, string *digest) {
			string<20> tmp, tmp2;
			string<36> addr_element;
			unsigned int i;
			string<4> count_buf;
			unsigned int progress_ctr;

			progress_ctr = pass*4096;

			count_buf = chr(0x0)+chr(0x0)+chr(0x0)+chr(count);
			addr_element = *ssid+count_buf;
			wln_hmac_sha1_vector(*passphrase,addr_element,tmp,0);

			*digest = tmp;

			for (i=1; i <= iterations-1; i++) {
				wln_hmac_sha1_vector(*passphrase,tmp,tmp2,0);

				tmp = tmp2;
				*digest = strxor(*digest,tmp2);

				progress_ctr = progress_ctr+1;
				if (progress_ctr % 82 == 0) {
					callback_wln_mkey_progress_update(progress_ctr/82);
				}
			}
		}
	#endif
#endif


#if PLATFORM_ID == EM510W 

//----------------------------------------------------------------------------
void wln_init_gpio() {
	//map interface lines (on platforms with fixed mapping this will have no effect and do no harm)
	//WA2000 Will remap DI as output and DO as input and clock as input as required. 

 	io.num = wln.clkmap;
	io.enabled = YES;
	io.state = 1;


	io.num = wln.csmap;
	io.enabled = YES;
	io.state = 0;


	io.num = wln.domap;
	io.enabled = YES;
	io.state = 0;


}

void wln_reset() {
	io.lineset(wln.csmap,LOW);
	io.lineset(wln.domap,HIGH);
	wln_delay_ms(1);
	io.lineset(wln.csmap,HIGH);
	io.lineset(wln.domap,LOW);
}

#else 

//----------------------------------------------------------------------------
void wln_init_gpio() {
	//map interface lines (on platforms with fixed mapping this will have no effect and do no harm)
	//WA2000 Will remap DI as output and DO as input and clock as input as required. 
	#if PLATFORM_ID  !=  WM2000 && PLATFORM_ID  !=  WS1101 && PLATFORM_ID != WS1102 
		wln.csmap = WLN_CS;
		io.num = WLN_CS;
		io.enabled = YES;
		wln.dimap = WLN_DI;
		wln.domap = WLN_DO;
		io.num = WLN_DO;
		io.enabled = YES;
		wln.clkmap = WLN_CLK;
		io.num = WLN_CLK;
		io.enabled = YES;
		io.num = WLN_RST;
		io.enabled = YES;
	#endif 
}

void wln_reset() {
	#if PLATFORM_ID  !=  WM2000 && PLATFORM_ID  !=  WS1101 && PLATFORM_ID != WS1102 
	#if WLN_RESET_MODE 
		io.lineset(wln.csmap,HIGH);
		io.lineset(wln.clkmap,LOW);
		io.lineset(wln.clkmap,HIGH);
	#else 
		//there is a dedicated reset line
		io.num = WLN_RST;
		io.state = LOW;
		wln_delay_ms(1);
		io.state = HIGH;
	#endif
	#endif
}

#endif 

//----------------------------------------------------------------------------
void wln_init() {
//upload the firmware for wifi module and setup WEP

	wln_scan_and_assoc_in_prog = NO;
	wln_associated = WLN_ASSOCIATION_RETVAL_NO;
	wln_rescan_in_prog = NO;
	wln_rescan_requested = NO;
	wln_updaterssi_requested = NO;

	#if WLN_DEBUG_PRINT
		wln_dont_print_stop = NO;
	#endif

	wln.disable();
	while (wln.enabled == YES) {
	}

	wln_init_gpio();
	wln_reset();
	wln_module_type = wln.getmoduletype();

	#if WLN_KEEP_ALIVE
		wln_keep_alive_socket = 255;
	#endif

	#if WLN_WPA	
		wln_wpa_socket = 255;
		wln_key = "";
	#endif
}


//T1000 Based Devices and EM500W

#if PLATFORM_ID == EM1000N || PLATFORM_ID == EM1001N || PLATFORM_ID == EM1202N || PLATFORM_ID == EM1206N || PLATFORM_ID == TPP2N || PLATFORM_ID == TPP3N || PLATFORM_ID == DS1101N || PLATFORM_ID == DS1102N
#else 
//These syscalls are not supported on T1000 devices except for the following specific platforms. This shim allows the wln library to work.  

//----------------------------------------------------------------------------
pl_wln_module_types getmoduletype() {
pl_wln_module_types getmoduletype;
    wln.getmoduletype();
    return getmoduletype;
}

//----------------------------------------------------------------------------
void disable() {
}

#endif

#endif


//----------------------------------------------------------------------------
#if WLN_DEBUG_PRINT
void wln_debug_print_status(en_wln_status_codes status) {
	string<64> s;
	switch (status) {
	case WLN_STATUS_OK:
s = "OK";
	break;
	case WLN_STATUS_OUT_OF_SOCKETS:
s = "ERROR: out of sockets";
	break;
	case WLN_STATUS_INSUFFICIENT_BUFFER_SPACE:
s = "ERROR: insufficient buffer space";
	break;
#if GA1000 
	case WLN_STATUS_MISSING_FIRMWARE_FILE:
s = "ERROR: missing '"+WLN_FIRMWARE_FILE+"' firmware file";
	break;
#endif
case WLN_STATUS_BOOT_FAILURE:
s = "ERROR: boot failure";
break;
	case WLN_STATUS_INVALID_SECURITY_MODE:
s = "ERROR: incorrect security mode";
	break;
	case WLN_STATUS_INVALID_WEP_KEY:
s = "ERROR: incorrect WEP key length";
	break;
	case WLN_STATUS_SCANNING_FAILURE:
s = "Access point not found";
	break;
	case WLN_STATUS_ASSOCIATION_FAILURE:
s = "Association failure";
	break;
	case WLN_STATUS_DISASSOCIATION:
s = "Disassociation (or link loss)";
	break;
	case WLN_STATUS_UNEXPECTED_ERROR:
s = "ERROR: unexpected error (Wi-Fi module is busy when it shoudn't be)";
	break;
	case WLN_STATUS_AUTOCONNECT:
s = "ERROR: Autoconnect is enabled. Module is automatically handling connections.";
	break;
	}

	wln_debugprint(s);
}
#endif

//------------------------------------------------------------------------------
#if WLN_DEBUG_PRINT
void wln_debugprint(string *print_data) {
	#if WLN_DEBUG_REDIR
		callback_wln_debugprint(*print_data);
	#else
		sys.debugprint(WLN_STAMP+*print_data+WLN_CR_LF);
	#endif
}
#endif

//#############################################################


void wln_autoconnect(bool enable) {
	wln_connect_enabled = enable;
}