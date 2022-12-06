
//***********************************************************************************************************
//			DHCP LIBRARY
//			(Works with NET, WLN)
//***********************************************************************************************************

#include "global.th"

//------------------------------------------------------------------------------
#define DHCP_STAMP1 "DHCP("
#define DHCP_STAMP2 ")> "
#define DHCP_CR_LF chr(13)+chr(10)
#define DHCP_MIN_BUFFER_SPACE 700//necessary!
#define DHCP_SOCK_BUFF_PAGES 3//necessary!
#define DHCP_INIT_SIGNATURE 0x3D4E
#define DHCP_SOCK_GET_SIGNATURE "DHCP"
#define DHCP_WLN_EXCHANGE_DELAY_CONST 4

#if NET_AVAILABLE == 1 && WLN_AVAILABLE == 1
	#define NUM_INTERFACES 2
#else
	#define NUM_INTERFACES 1
#endif

//------------------------------------------------------------------------------
enum en_dhcp_phases {
	DHCP_PHASE_DISCOVER,
	DHCP_PHASE_DISCOVER_REPLY,
	DHCP_PHASE_REQUEST,
	DHCP_PHASE_REQUEST_REPLY,
	DHCP_PHASE_IDLE,
	DHCP_PHASE_OFF
};

//------------------------------------------------------------------------------
void dhcp_proc_one_interface(pl_sock_interfaces interface);
void dhcp_error(pl_sock_interfaces interface);
ok_ng dhcp_sock_open(pl_sock_interfaces interface, en_dhcp_phases phase);
void dhcp_sock_close();
void send_dhcp(string<16> *obtained_ip, string<32> *device_name, pl_sock_interfaces interface);
void dhcp_check_if_all_finished();
void discard_sockets(pl_sock_interfaces interface);
void dhcp_init();
void dhcp_debug_print_status(pl_sock_interfaces interface, en_dhcp_status_codes status);
void dhcp_debugprint(pl_sock_interfaces interface, string *print_data);

//------------------------------------------------------------------------------
unsigned char dhcp_sock;
en_dhcp_phases dhcp_phase[NUM_INTERFACES];
no_yes dhcp_renew[NUM_INTERFACES];
unsigned char dhcp_i;
string<16> device_name;
string<16> dhcp_server_ip[NUM_INTERFACES];
string<16> dhcp_obtained_ip[NUM_INTERFACES];
string<16> dhcp_obtained_gateway[NUM_INTERFACES];
string<16> dhcp_obtained_netmask[NUM_INTERFACES];
unsigned long dhcp_obtained_lease_time[NUM_INTERFACES];
unsigned long dhcp_timer[NUM_INTERFACES];
unsigned char dhcp_retry_ctr[NUM_INTERFACES];
pl_sock_interfaces dhcp_interface_token;
unsigned char dhcp_current_interface;
unsigned int dhcp_init_flag;
string<DHCP_MAX_HOST_NAME_LEN> dhcp_host_name[NUM_INTERFACES];
#if DHCP_DEBUG_PRINT
	no_yes dhcp_media_linked[NUM_INTERFACES];
#endif
#if WLN_AVAILABLE
	unsigned char dhcp_wln_exchange_delay;
#endif
no_yes dhcp_ingnore_link_disconnects[NUM_INTERFACES];

//==============================================================================
string dhcp_get_info(dhcp_info_elements info_element, string *extra_data) {
string dhcp_get_info;
//Returns library-specific information for the requested info element

	dhcp_get_info = "";
	switch (info_element) {
	case DHCP_INFO_ELEMENT_REQUIRED_BUFFERS:

		dhcp_get_info = str(DHCP_SOCK_BUFF_PAGES*2);
		break;

	}
	return dhcp_get_info;
}

//--------------------------------------------------------------------
en_dhcp_status_codes dhcp_start(pl_sock_interfaces interface, string *requested_ip, string *host_name) {
en_dhcp_status_codes dhcp_start;
//API procedure, starts DHCP client on the specified network interface.

	if (dhcp_init_flag != DHCP_INIT_SIGNATURE) {
		dhcp_init();
		dhcp_init_flag = DHCP_INIT_SIGNATURE;
	}

	dhcp_start = DHCP_STATUS_OK;

	#if DHCP_DEBUG_PRINT
		dhcp_debugprint(interface,"---START---");
	#endif

	//we only need to obtain a socket once
	if (dhcp_sock>=sock.numofsock) {
		dhcp_sock = sock_get(DHCP_SOCK_GET_SIGNATURE);
	}

	if (dhcp_sock>=sock.numofsock) {
		#if DHCP_DEBUG_PRINT
			dhcp_debug_print_status(interface,DHCP_STATUS_OUT_OF_SOCKETS);
			dhcp_debugprint(interface,"---FAILURE---");
		#endif
		dhcp_start = DHCP_STATUS_OUT_OF_SOCKETS;
		return dhcp_start;
	}

	#if NET_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_NET) {
			goto dhcp_start_continue;
		}
	#endif

	#if WLN_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_WLN) {
			goto dhcp_start_continue;
		}
	#endif

	#if DHCP_DEBUG_PRINT
		dhcp_debug_print_status(interface,DHCP_STATUS_INVALID_INTERFACE);
		dhcp_debugprint(interface,"---FAILURE---");
	#endif
	dhcp_start = DHCP_STATUS_INVALID_INTERFACE;
	return dhcp_start;//invalid interface specified

dhcp_start_continue: 
	if (NUM_INTERFACES == 1) {
		dhcp_i = 0;
	} else {
		dhcp_i = interface-1;
	}

	if (len(ddval(*requested_ip)) == 4) {
		dhcp_obtained_ip[dhcp_i] = *requested_ip;
	} else {
		dhcp_obtained_ip[dhcp_i] = "";
	}

	dhcp_host_name[dhcp_i] = *host_name;

	if (dhcp_phase[dhcp_i] == DHCP_PHASE_OFF) {
		dhcp_timer[dhcp_i] = 1;
		dhcp_retry_ctr[dhcp_i] = DHCP_MAX_RETRIES;
		dhcp_phase[dhcp_i] = DHCP_PHASE_DISCOVER;
	} else {
		#if DHCP_DEBUG_PRINT
			dhcp_debugprint(interface,"Already started");
		#endif
	}
	return dhcp_start;
}

//------------------------------------------------------------------------------
en_dhcp_status_codes dhcp_stop(pl_sock_interfaces interface) {
en_dhcp_status_codes dhcp_stop;
//API procedure, stops DHCP client on the specified network interface.

	if (dhcp_init_flag != DHCP_INIT_SIGNATURE) {
		dhcp_init();
		dhcp_init_flag = DHCP_INIT_SIGNATURE;
	}

	dhcp_stop = DHCP_STATUS_OK;

	#if DHCP_DEBUG_PRINT
		dhcp_debugprint(interface,"---STOP---");
	#endif

	#if NET_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_NET) {
			goto dhcp_stop_continue;
		}
	#endif

	#if WLN_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_WLN) {
			goto dhcp_stop_continue;
		}
	#endif

	#if DHCP_DEBUG_PRINT
		dhcp_debug_print_status(interface,DHCP_STATUS_INVALID_INTERFACE);
		dhcp_debugprint(interface,"Did not stop");
	#endif
	dhcp_stop = DHCP_STATUS_INVALID_INTERFACE;
	return dhcp_stop;//invalid interface specified

dhcp_stop_continue: 
	if (NUM_INTERFACES == 1) {
		dhcp_i = 0;
	} else {
		dhcp_i = interface-1;
	}

	dhcp_timer[dhcp_i] = 0;
	dhcp_phase[dhcp_i] = DHCP_PHASE_OFF;
	return dhcp_stop;
}

//------------------------------------------------------------------------------
void dhcp_set_link_disconnect_behavior(pl_sock_interfaces interface, no_yes behavior) {
//API procedure, sets the behavior in case a network interface becomes disconnected
//(Ethernet cable unplugged or Wi-Fi disassociated). Behavior=NO means that when the link is
//reestablished the DHCP will be repeated for this interface. YES means that reestablishing the link
//will not lead to the DHCP restart.
	unsigned char dhcp_i;

	if (NUM_INTERFACES == 1) {
		dhcp_i = 0;
	} else {
		dhcp_i = interface-1;
	}
	dhcp_ingnore_link_disconnects[dhcp_i] = behavior;
}

//------------------------------------------------------------------------------
void dhcp_proc_timer() {
//Event procedure, call it from the on_sys_timer() event handler.

	if (dhcp_init_flag != DHCP_INIT_SIGNATURE) {
		return;
	}

	sock.num = dhcp_sock;

	dhcp_current_interface = dhcp_current_interface+1;
	if (dhcp_current_interface>=2) {
		dhcp_current_interface = 0;
	}

	#if NET_AVAILABLE
		if (dhcp_current_interface == 0) {
			dhcp_proc_one_interface(PL_SOCK_INTERFACE_NET);
			return;
		}
	#endif

	#if WLN_AVAILABLE
		if (dhcp_current_interface == 1) {
			dhcp_proc_one_interface(PL_SOCK_INTERFACE_WLN);
			return;
		}
	#endif
}

//------------------------------------------------------------------------------
void dhcp_proc_one_interface(pl_sock_interfaces interface) {
//Event procedure, call it from the on_sock_data_arrival() event handler.

	if (NUM_INTERFACES == 1) {
		dhcp_i = 0;
	} else {
		dhcp_i = interface-1;
	}

	#if NET_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_NET) {
			if (dhcp_phase[dhcp_i] != DHCP_PHASE_OFF) {
				if (net.linkstate == PL_NET_LINKSTAT_NOLINK) {
					if (dhcp_ingnore_link_disconnects[dhcp_i] != NO) { return;}

					dhcp_phase[dhcp_i] = DHCP_PHASE_IDLE;
					dhcp_renew[dhcp_i] = NO;
					dhcp_timer[dhcp_i] = 1;
					dhcp_retry_ctr[dhcp_i] = DHCP_MAX_RETRIES;
					#if DHCP_DEBUG_PRINT
						dhcp_media_linked[dhcp_i] = NO;
					#endif
					return;
				} else {
					#if DHCP_DEBUG_PRINT
						if (dhcp_media_linked[dhcp_i] == NO) {
							dhcp_debugprint(interface,"Ethernet cable plugged in -- DHCP (re)started");
						}
						dhcp_media_linked[dhcp_i] = YES;
					#endif
				}
			}
		}
	#endif

	#if WLN_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_WLN) {
			if (dhcp_phase[dhcp_i] != DHCP_PHASE_OFF) {
#if PLATFORM_ID  ==  WM2000 || PLATFORM_ID  ==  WS1102
				if (wln.associationstate == PL_WLN_NOT_ASSOCIATED) {
#else 
				if (wln_check_association() == PL_WLN_NOT_ASSOCIATED) {
#endif 
					if (dhcp_ingnore_link_disconnects[dhcp_i] != NO) { return;}

					dhcp_wln_exchange_delay = DHCP_WLN_EXCHANGE_DELAY_CONST;
					dhcp_phase[dhcp_i] = DHCP_PHASE_IDLE;
					dhcp_renew[dhcp_i] = NO;
					dhcp_timer[dhcp_i] = 1;
					dhcp_retry_ctr[dhcp_i] = DHCP_MAX_RETRIES;
					#if DHCP_DEBUG_PRINT
						dhcp_media_linked[dhcp_i] = NO;
					#endif
					return;
				} else {
					if (dhcp_wln_exchange_delay>0) {
						dhcp_wln_exchange_delay = dhcp_wln_exchange_delay-1;
						return;
					}

					#if DHCP_DEBUG_PRINT
						if (dhcp_media_linked[dhcp_i] == NO) {
							dhcp_debugprint(interface,"Wi-Fi interface associated with the AP -- DHCP (re)started");
						}
						dhcp_media_linked[dhcp_i] = YES;
					#endif
				}
			}
		}
	#endif

	if (dhcp_timer[dhcp_i] == 0) {
		return;
	} else {
		dhcp_timer[dhcp_i] = dhcp_timer[dhcp_i]-1;
		if (dhcp_timer[dhcp_i]>0) {
			return;
		}
	}

	#if NET_AVAILABLE && WLN_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_NET) {
			if (dhcp_interface_token == PL_SOCK_INTERFACE_WLN && dhcp_phase[PL_SOCK_INTERFACE_NET-1] != DHCP_PHASE_OFF) {
				if (dhcp_timer[PL_SOCK_INTERFACE_NET-1] == 0) {
					dhcp_timer[PL_SOCK_INTERFACE_NET-1] = 1;
				}
				return;
			}
		} else {
			if (dhcp_interface_token == PL_SOCK_INTERFACE_NET && dhcp_phase[PL_SOCK_INTERFACE_WLN-1] != DHCP_PHASE_OFF) {
				if (dhcp_timer[PL_SOCK_INTERFACE_WLN-1] == 0) {
					dhcp_timer[PL_SOCK_INTERFACE_WLN-1] = 1;
				}
				return;
			}
		}
	#endif

	switch (dhcp_phase[dhcp_i]) {

	case DHCP_PHASE_IDLE:

		if (dhcp_renew[dhcp_i] == NO) {
			dhcp_phase[dhcp_i] = DHCP_PHASE_DISCOVER;
			goto label1;
		} else {
			#if DHCP_DEBUG_PRINT
				dhcp_debugprint(interface,"Time to renew the lease");
			#endif
			dhcp_phase[dhcp_i] = DHCP_PHASE_REQUEST;
			goto label2;
		}
		break;

	case DHCP_PHASE_DISCOVER:

label1: if (dhcp_sock_open(interface,DHCP_PHASE_DISCOVER) != OK) {
			dhcp_error(interface);
			return;
		}
		#if DHCP_DEBUG_PRINT
			dhcp_debugprint(interface,"TX discovery message");
		#endif
		send_dhcp(dhcp_obtained_ip[dhcp_i],device_name,interface);
		dhcp_phase[dhcp_i] = DHCP_PHASE_DISCOVER_REPLY;
		dhcp_timer[dhcp_i] = DHCP_WAIT_TIME;
		return;
		break;

	case DHCP_PHASE_DISCOVER_REPLY:

		#if DHCP_DEBUG_PRINT
			dhcp_debugprint(interface,"ERROR: Timeout waiting for offer message");
		#endif
		dhcp_error(interface);
		return;
		break;

	case DHCP_PHASE_REQUEST:

label2: if (dhcp_sock_open(interface,DHCP_PHASE_REQUEST) != OK) {
			dhcp_error(interface);
			return;
		}
		#if DHCP_DEBUG_PRINT
			dhcp_debugprint(interface,"TX request message");
		#endif
		send_dhcp(dhcp_obtained_ip[dhcp_i],device_name,interface);
		dhcp_phase[dhcp_i] = DHCP_PHASE_REQUEST_REPLY;
		dhcp_timer[dhcp_i] = DHCP_WAIT_TIME;
		return;
		break;

	case DHCP_PHASE_REQUEST_REPLY:

		#if DHCP_DEBUG_PRINT
			dhcp_debugprint(interface,"ERROR: Timeout waiting for confirmation message");
		#endif
		dhcp_error(interface);
		return;
		break;

	}}
}

//------------------------------------------------------------------------------
void dhcp_proc_data() {
	pl_sock_interfaces interface;
	string s;
	string<32> s2;
	unsigned char x, f;
	unsigned char message_type;
	no_yes t1_found;
	string<6> mac;

	for (f=0; f <= NUM_INTERFACES-1; f++) {
		if (dhcp_init_flag == DHCP_INIT_SIGNATURE && dhcp_phase[f] != DHCP_PHASE_OFF) {
			goto dhcp_is_active;
		}
	}
	return;

dhcp_is_active: 
	if (sock.num != dhcp_sock) {
		return;
	}

	s = sock.getdata(236);//read all the data up to a magic cookie

	//verify opcode: must be "reply" (2)
	//verify hardware type: must be "ethernet" (1)
	//verify hardware address length: must be (6)
	if (ddstr(mid(s,1,3)) != "2.1.6") {
		goto dhcp_proc_data_error;
	}

	//verify transaction ID (must match our last 4 digits of MAC address)
	#if NET_AVAILABLE
		mac = ddval(net.mac);
		if (mid(s,5,4) == right(mac,4)) {
			interface = PL_SOCK_INTERFACE_NET;
			goto decode_packet;
		}
	#endif

	#if WLN_AVAILABLE
		mac = ddval(wln.mac);
		if (mid(s,5,4) == right(mac,4)) {
			interface = PL_SOCK_INTERFACE_WLN;
			goto decode_packet;
		}
	#endif

	goto dhcp_proc_data_error;

decode_packet: 
	if (NUM_INTERFACES == 1) {
		dhcp_i = 0;
	} else {
		dhcp_i = interface-1;
	}

	//branch according to the phase
	switch (dhcp_phase[dhcp_i]) {
	case DHCP_PHASE_DISCOVER_REPLY:

		//make sure IP-address being offered is valid
		//first number cannot exceed 223
		if (asc(mid(s,17,1))>223) {
			goto dhcp_proc_data_error;
		}

		//last number cannot be 0 or 255
		x = asc(mid(s,20,1));
		if (x == 0 || x == 255) {
			goto dhcp_proc_data_error;
		}

		//IP-address being offered is correct- extract it!
		dhcp_obtained_ip[dhcp_i] = ddstr(mid(s,17,4));
		break;

	case DHCP_PHASE_REQUEST_REPLY:

		//Make sure that the IP-address the DHCP supplied now (ACK) is the same as in OFFER message
		//(or the same we've been using if we are extending the lease)
		s2 = ddstr(mid(s,17,4));
		if (dhcp_obtained_ip[dhcp_i] != s2) {
			goto dhcp_proc_data_error;
		}
		break;

	default:
		#if DHCP_DEBUG_PRINT
			dhcp_debugprint(interface,"INFO: RX unexpected message (wasn't expecting anything at the moment)");
		#endif
		goto dhcp_proc_data_error;break;

	}

	//This part is common for all types of replies received from the DHCP server.
	//Extract and verify our own MAC (must be returned by the server)
	if (mid(s,29,6) != mac) {
			goto dhcp_proc_data_error;
	}

	//Read magic cookie and options
	s = sock.getdata(255);

	//Check magic cookie
	if (ddstr(mid(s,1,4)) != "99.130.83.99") {
		goto dhcp_proc_data_error;
	}

	dhcp_obtained_lease_time[dhcp_i] = 4294967295;//first, assume max lease time
	t1_found = NO;

	//Look through options and extract the ones we need. Only one option-
	//message type is REALLY a mast
	for (f=5; f <= len(s); f++) {
		switch (asc(mid(s,f,1))) {
		case 255:
//reached the end of all options
			goto exit_options;
			break;

		case 0:
//this is a "padding"- just skip it
			goto next_option;
			break;

		case 53:
//OK, we HAD to have this option (message type)- make sure its length is 1
			if (asc(mid(s,f+1,1)) != 1) {
				goto dhcp_proc_data_error;
			}
			//now get the message type and see if it is correct
			message_type = asc(mid(s,f+2,1));
			switch (dhcp_phase[dhcp_i]) {
			case DHCP_PHASE_DISCOVER_REPLY:

				if (message_type != 2) {
					goto dhcp_proc_data_error;
				}
				break;

			case DHCP_PHASE_REQUEST_REPLY:

				if (message_type != 5) {
					goto dhcp_proc_data_error;
				}
				break;

			default:break;

			}
			f = f+2;
			break;

		case 1:
//netmask option!- make sure its length is 5
			if (asc(mid(s,f+1,1)) != 4) {
				goto dhcp_proc_data_error;
			}
			dhcp_obtained_netmask[dhcp_i] = ddstr(mid(s,f+2,4));
			f = f+5;
			break;

		case 3:
//default gateway IP option!- there can be N gateways, length must be 4*n
			x = asc(mid(s,f+1,1));
			if (x<4 || x-(x/4)*4 != 0) {
				goto dhcp_proc_data_error;
			}
			dhcp_obtained_gateway[dhcp_i] = ddstr(mid(s,f+2,4));
			f = f+1+x;
			break;

		case 51:
//offered lease time
			//only process this if no T1 option was encountered yet
			if (t1_found == NO) {
				goto get_lease;
			}
			f = f+5;
			break;

		case 59:
//T1- renewal time
			t1_found = YES;
get_lease: if (asc(mid(s,f+1,1)) != 4) {
				goto dhcp_proc_data_error;
			}

			//renewal time is a 4-byte value (in seconds)
			dhcp_obtained_lease_time[dhcp_i] = asc(mid(s,f+2,1))*16777216+asc(mid(s,f+3,1))*65536+asc(mid(s,f+4,1))*256+asc(mid(s,f+5,1));
			f = f+5;
			break;

		case 54:
//server identifier option
			if (asc(mid(s,f+1,1)) != 4) {
				goto dhcp_proc_data_error;
			}
			dhcp_server_ip[dhcp_i] = ddstr(mid(s,f+2,4));
			f = f+5;
			break;

		default://some other option: just skip it
			x = asc(mid(s,f+1,1));
			f = f+x+1;break;

		}
next_option: 
	}

exit_options: 
	//packet decoded successfully
	switch (dhcp_phase[dhcp_i]) {
	case DHCP_PHASE_DISCOVER_REPLY:

		#if DHCP_DEBUG_PRINT
			dhcp_debugprint(interface,"RX offer message");
		#endif
		dhcp_phase[dhcp_i] = DHCP_PHASE_REQUEST;
		dhcp_timer[dhcp_i] = 1;
		dhcp_sock_close();
		break;

	case DHCP_PHASE_REQUEST_REPLY:

		#if DHCP_DEBUG_PRINT
			dhcp_debugprint(interface,"RX confirmation message");
		#endif
		//DHCP interaction completed successfully
		dhcp_phase[dhcp_i] = DHCP_PHASE_IDLE;
		dhcp_timer[dhcp_i] = (dhcp_obtained_lease_time[dhcp_i]/10)*9;
		dhcp_sock_close();
		dhcp_check_if_all_finished();
		#if DHCP_DEBUG_PRINT
			dhcp_debugprint(interface,"---OK(ip: "+dhcp_obtained_ip[dhcp_i]+", gateway: "+dhcp_obtained_gateway[dhcp_i]+", netmask: "+dhcp_obtained_netmask[dhcp_i]+", lease: "+lstr(dhcp_obtained_lease_time[dhcp_i])+" sec.)---");
		#endif
		callback_dhcp_ok(dhcp_renew[dhcp_i],interface,dhcp_obtained_ip[dhcp_i],dhcp_obtained_gateway[dhcp_i],dhcp_obtained_netmask[dhcp_i],dhcp_obtained_lease_time[dhcp_i]);
		sock.num = dhcp_sock;
		dhcp_renew[dhcp_i] = YES;
		break;
	}
	return;

dhcp_proc_data_error: 
	#if DHCP_DEBUG_PRINT
		dhcp_debugprint(interface,"INFO: RX unexpected, invalid, or unrelated message (it was discarded)");
	#endif
}

//------------------------------------------------------------------------------
void dhcp_error(pl_sock_interfaces interface) {
	//DHCP error
	dhcp_sock_close();

	if (dhcp_phase[dhcp_i] != DHCP_PHASE_OFF) {
		dhcp_phase[dhcp_i] = DHCP_PHASE_IDLE;
		dhcp_check_if_all_finished();
	}

	if (dhcp_retry_ctr[dhcp_i]>0) {
		dhcp_timer[dhcp_i] = ((asc(random(1))) % DHCP_MAX_RETRY_DELAY)+1;
		dhcp_retry_ctr[dhcp_i] = dhcp_retry_ctr[dhcp_i]-1;
	} else {
		dhcp_retry_ctr[dhcp_i] = DHCP_MAX_RETRIES;
		dhcp_timer[dhcp_i] = DHCP_POST_FAIL_DELAY;//DHCP failed, try again in 3 mins
		#if DHCP_DEBUG_PRINT
			dhcp_debug_print_status(interface,DHCP_STATUS_FAILURE);
		#endif
		callback_dhcp_failure(interface,DHCP_STATUS_FAILURE);
		sock.num = dhcp_sock;
	}
}

//------------------------------------------------------------------------------
ok_ng dhcp_sock_open(pl_sock_interfaces interface, en_dhcp_phases phase) {
ok_ng dhcp_sock_open;
	unsigned char x;
	unsigned int i;

	dhcp_interface_token = interface;
	sock.num = dhcp_sock;

	//for DHCP DISCOVER, we need to have the IP address at 0.0.0.0
	if (phase == DHCP_PHASE_DISCOVER) {
		#if NET_AVAILABLE
			if (interface == PL_SOCK_INTERFACE_NET) {
				if (net.ip != "0.0.0.0") {
					callback_dhcp_pre_clear_ip(PL_SOCK_INTERFACE_NET);
					sock.num = dhcp_sock;
					sock.inconenabledmaster = NO;
					discard_sockets(PL_SOCK_INTERFACE_NET);
					net.ip = "0.0.0.0";
					sock.inconenabledmaster = YES;
				}
			}
		#endif

		#if WLN_AVAILABLE
			if (interface == PL_SOCK_INTERFACE_WLN) {
				if (wln.ip != "0.0.0.0") {
					callback_dhcp_pre_clear_ip(PL_SOCK_INTERFACE_WLN);
					sock.num = dhcp_sock;
					sock.inconenabledmaster = NO;
					discard_sockets(PL_SOCK_INTERFACE_WLN);
					wln.ip = "0.0.0.0";
					sock.inconenabledmaster = YES;
				}
			}
		#endif
	}

	//arrange buffer space
	if (sock.rxbuffsize<DHCP_MIN_BUFFER_SPACE || sock.txbuffsize<DHCP_MIN_BUFFER_SPACE) {
		sock.rxbuffrq(0);
		sock.txbuffrq(0);
		sys.buffalloc();

		if (sys.freebuffpages<DHCP_SOCK_BUFF_PAGES*2) {
			if (sys.freebuffpages>DHCP_SOCK_BUFF_PAGES*2) {
				x = DHCP_SOCK_BUFF_PAGES*2;
			} else {
				x = DHCP_SOCK_BUFF_PAGES*2-sys.freebuffpages;
			}
			callback_dhcp_pre_buffrq(x);
			sock.num = dhcp_sock;
		}

		sock.rxbuffrq(DHCP_SOCK_BUFF_PAGES);
		sock.txbuffrq(DHCP_SOCK_BUFF_PAGES);
		sys.buffalloc();
		if (sock.rxbuffsize<DHCP_MIN_BUFFER_SPACE || sock.txbuffsize<DHCP_MIN_BUFFER_SPACE) {
			#if DHCP_DEBUG_PRINT
				dhcp_debug_print_status(interface,DHCP_STATUS_INSUFFICIENT_BUFFER_SPACE);
			#endif
			dhcp_sock_open = NG;
			return dhcp_sock_open;
		}
	}

	//setup the socket itself
	sock.allowedinterfaces = "WLN,NET";
	sock.protocol = PL_SOCK_PROTOCOL_UDP;
	sock.targetport = 67;
	sock.outport = 68;
	sock.targetbcast = YES;
	sock.acceptbcast = YES;
	sock.connectiontout = 600;
	sock.inconmode = PL_SOCK_INCONMODE_ANY_IP_ANY_PORT;
	sock.reconmode = PL_SOCK_RECONMODE_3;

	#if NET_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_NET) {
			sock.targetinterface = PL_SOCK_INTERFACE_NET;
		}
	#endif

	#if WLN_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_WLN) {
			sock.targetinterface = PL_SOCK_INTERFACE_WLN;
		}
	#endif

	if (sock.statesimple == PL_SSTS_CLOSED) {
		i = sys.timercount;
		sock.connect();
dhcp_1: 
		if (sock.statesimple != PL_SSTS_EST && sys.timercount-i<3 && sys.timercount>=i) {
			goto dhcp_1;
		}
	}
	dhcp_sock_open = OK;
	return dhcp_sock_open;
}

//------------------------------------------------------------------------------
void dhcp_sock_close() {
	unsigned int i;

	i = sys.timercount;
	sock.discard();
	while (sock.statesimple != PL_SSTS_CLOSED && sys.timercount-i<3 && sys.timercount>=i) {
	}
	dhcp_interface_token = PL_SOCK_INTERFACE_NULL;
}

//------------------------------------------------------------------------------
void dhcp_check_if_all_finished() {
	unsigned char f;

	for (f=0; f <= NUM_INTERFACES-1; f++) {
		if (dhcp_phase[f] != DHCP_PHASE_IDLE && dhcp_phase[f] != DHCP_PHASE_OFF) {
			return;
		}
	}

	sock.num = dhcp_sock;
	sock.rxbuffrq(0);
	sock.txbuffrq(0);
	sys.buffalloc();
	callback_dhcp_buff_released();
	sock.num = dhcp_sock;
}

//------------------------------------------------------------------------------
void send_dhcp(string<16> *obtained_ip, string<32> *device_name, pl_sock_interfaces interface) {
	string s;
	string<6> mac;
	string<4> ip;

	#if NET_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_NET) {
			mac = ddval(net.mac);
			ip = ddval(net.ip);
		}
	#endif
	#if WLN_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_WLN) {
			mac = ddval(wln.mac);
			ip = ddval(wln.ip);
		}
	#endif

	//1.1.6.0- opcode=rq, hware type= Ethernet, hardware addr len= 6, hop count=0
	s = ddval("1.1.6.0");

	//transaction ID- last 4 bytes of MAC address
	s = s+right(mac,4);

	//0.0- number of seconds
	//128.0- set broadcast flag
	s = s+ddval("0.0.128.0");

	switch (dhcp_phase[dhcp_i]) {
	case DHCP_PHASE_DISCOVER:

		//for DISCOVER message all fields until MAC-address are unused	
		//set client ip, your ip, server ip, gateway ip all to zeroes.
		s = s+strgen(16,chr(0));
		break;

	case DHCP_PHASE_REQUEST:

		//our IP address and the field for server-suggested IP- fill with zeroes to avoid problems
		s = s+strgen(8,chr(0));

		//supply IP-address of the server (we obtained from the OFFER message)- this is required
		s = s+strgen(4,chr(0));

		//no need to set gateway IP
		s = s+strgen(4,chr(0));
		break;

	default:break;
	}

	s = s+mac;//client MAC

	sock.setdata(s);

	//now we just need 204 empty bytes
	s = strgen(202,chr(0));
	sock.setdata(s);

	//continue...
	s = ddval("99.130.83.99");//magic cookie

	switch (dhcp_phase[dhcp_i]) {
	case DHCP_PHASE_DISCOVER:

		//53.1.1- set message type to DISCOVER
		s = s+ddval("53.1.1");

		//116.1.1 - DHCP Auto Configuration
		s = s+ddval("116.1.1");

		//61.7 - Client Identifier
		s = s+ddval("61.7.1.")+mac;

		//50.4- suggest our current IP only if IP was assigned already
		if (*obtained_ip != "") {
			s = s+ddval("50.4."+*obtained_ip);//suggest our current IP
		} else {
			s = s+ddval("50.4.")+ip;
		}

		//51.4.255.255.255.255- suggest maximum lease time
		s = s+ddval("51.4.255.255.255.255");

		//55.2.1.3- provide a list of parameters we need
		s = s+ddval("55.2.1.3");
		break;

	case DHCP_PHASE_REQUEST:

		//53.1.3- set message type to REQUEST
		s = s+ddval("53.1.3");

		//Our identifier
		s = s+ddval("61.7.1")+mac;

		//54.4- specify the DHCP server we are addressing
		s = s+ddval("54.4")+ddval(dhcp_server_ip[dhcp_i]);

		//50.4- requested IP (this is the IP-address that the DHCP server has suggested)
		s = s+ddval("50.4")+ddval(*obtained_ip);

		//add host name option if not empty
		if (dhcp_host_name[dhcp_i] != "") {
			s = s+chr(12)+chr(len(dhcp_host_name[dhcp_i]))+dhcp_host_name[dhcp_i];
		}

		//55.2.1.3- provide a list of parameters we need
		s = s+ddval("55.2.1.3");
		break;

	default:break;

	}

	//add host name option if our owner name or device name is set
	if (*device_name != "") {
		s = s+chr(12)+chr(len(*device_name))+*device_name;
	}

	//end of all options and send!
	//We pad the packet for compatibility to certain DHCP server that conforms to BOOTP packet size
	sock.setdata(s+CHR(255)+strgen(319-len(s),CHR(0)));
	sock.send();
}

//--------------------------------------------------------------------
void discard_sockets(pl_sock_interfaces interface) {
	unsigned char f, sock_bup;
	unsigned int i;

	sock_bup = sock.num;

	for (f=0; f <= sock.numofsock-1; f++) {
		sock.num = f;
		if (sock.currentinterface == interface && sock.statesimple != PL_SSTS_CLOSED) {
			sock.discard();
		}
	}

	i = sys.timercount;
wait_discard: 
	for (f=0; f <= sock.numofsock-1; f++) {
		sock.num = f;
		if (sock.currentinterface == interface && sock.statesimple != PL_SSTS_CLOSED && sys.timercount-i<3 && sys.timercount>=i) {
			goto wait_discard;
		}
	}

	sock.num = sock_bup;
}

//----------------------------------------------------------------------------
void dhcp_init() {
	unsigned char f;

	dhcp_sock = 255;//important!
	for (f=0; f <= NUM_INTERFACES-1; f++) {
		dhcp_phase[f] = DHCP_PHASE_OFF;
		dhcp_renew[f] = NO;
		dhcp_timer[f] = 0;
		#if DHCP_DEBUG_PRINT
			dhcp_media_linked[f] = YES;//correct, it is YES
		#endif
		dhcp_ingnore_link_disconnects[f] = NO;
	}
	dhcp_current_interface = 0;

	#if WLN_AVAILABLE
		dhcp_wln_exchange_delay = DHCP_WLN_EXCHANGE_DELAY_CONST;
	#endif
}

//----------------------------------------------------------------------------
#if DHCP_DEBUG_PRINT
void dhcp_debug_print_status(pl_sock_interfaces interface, en_dhcp_status_codes status) {
	string<64> s;
	switch (status) {
	case DHCP_STATUS_OK:
s = "OK";
	break;
	case DHCP_STATUS_OUT_OF_SOCKETS:
s = "out of sockets";
	break;
	case DHCP_STATUS_INVALID_INTERFACE:
s = "invalid interface";
	break;
	case DHCP_STATUS_INSUFFICIENT_BUFFER_SPACE:
s = "insufficient buffer space";
	break;
	case DHCP_STATUS_FAILURE:
s = "DHCP process failed";
	break;
	}
	dhcp_debugprint(interface,"ERROR: "+s);
}
#endif

//------------------------------------------------------------------------------
#if DHCP_DEBUG_PRINT
void dhcp_debugprint(pl_sock_interfaces interface, string *print_data) {
	string<16> s;

	#if NET_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_NET) {
			s = "net";
			goto dhcp_debugprint_1;
		}
	#endif

	#if WLN_AVAILABLE
		if (interface == PL_SOCK_INTERFACE_WLN) {
			s = "wln";
			goto dhcp_debugprint_1;
		}
	#endif

	s = str(interface)+"??";

dhcp_debugprint_1: 
	sys.debugprint(DHCP_STAMP1+s+DHCP_STAMP2+*print_data+DHCP_CR_LF);
}
#endif
