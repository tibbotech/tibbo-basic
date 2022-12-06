#include "global.th"

bool upload_started = false;
pl_upg_state_t current_fw_upg_state;
bool isBtConnected = false;
string<128> fw_buffer = "";
unsigned long pattern_timer = sys.timercount32;
unsigned char led_detect_timer;
socket_assignment upgrade_socket_number;


void device_firmware_init(PL_FW_UPG_SOURCE source, unsigned char number) {
	int i;

	current_fw_upg_state.source = source;
	current_fw_upg_state.source_num = number;
	current_fw_upg_state.state = PL_FW_UPG__INIT;
	current_fw_upg_state.fw_fail_reason = PL_FW_FAIL_NONE;
	current_fw_upg_state.fw_numfiles = 0;
	current_fw_upg_state.fw_receivedfiles = 0;
	for (i=0; i <= MAX_NUM_FILE_UPG-1; i++) {
		current_fw_upg_state.fw_types(i) = 0;
		current_fw_upg_state.fw_lengths(i) = 0;
		current_fw_upg_state.fw_checksums(i) = 0;
	}
	current_fw_upg_state.fw_currentfile = 0;
	current_fw_upg_state.fw_total_percent = 0;
	current_fw_upg_state.fw_percent = 0;
	current_fw_upg_state.fw_remaining = 0;
	current_fw_upg_state.fw_sector = 0;
	current_fw_upg_state.fw_page = 0;
	current_fw_upg_state.fw_checksum = 0;
	current_fw_upg_state.fw_total_remaining = 0;

}

// sub led_upgrade_pattern()

// 	if sys.timercount32-pattern_timer>=1 then
// 		if led_detect_timer<4 then
// 			led_detect_timer=led_detect_timer+1
// 		else
// 			led_detect_timer=0
// 		end if
// 		pattern_timer = sys.timercount32
// 	end if

// 	select case led_detect_timer
// 	case 0:
// 		set_LED(&b00001)
// 	case 1:
// 		set_LED(&b00010)
// 	case 2:
// 		set_LED(&b00100)
// 	case 3:
// 		set_LED(&b01000)
// 	case 4:
// 		set_LED(&b10000)
// 	end select	

// end sub

string hex_mac(string mac) {
string hex_mac;
	int i = 0;
	int startpos = 1;
	int endpos = 0;
	unsigned int num = "";
	string result = "";

	for (i=0; i <= 5; i++) {
		endpos = instr(startpos,mac,".",0);
		num = val(mid(mac,startpos,endpos-startpos));
		if (num != 0) {
			result = result+right(hex(num),2)+":";
		} else {
			result = result+"00"+":";
		}
		startpos = endpos+1;
	}

	hex_mac = left(result,len(result)-1);

return hex_mac;
}

void device_firmware_download_init() {

switch (current_fw_upg_state.source) {
	case PL_FW_UPG_BLE:

		current_fw_upg_state.state = PL_FW_READ_HEADER;
		break;
	case PL_FW_UPG_WEB:

		current_fw_upg_state.state = PL_FW_READ_HEADER;
		break;
	case PL_FW_UPG_SOCK:

		current_fw_upg_state.state = PL_FW_READ_HEADER;
		break;
	case PL_FW_UPG_SER:

		current_fw_upg_state.state = PL_FW_READ_HEADER;
		break;
	case PL_FW_UPG_HTTP:

		current_fw_upg_state.state = PL_FW_READ_HEADER;
		break;
	default:
		current_fw_upg_state.fw_fail_reason = PL_FW_FAIL_SOURCE_UNKNOWN;
		current_fw_upg_state.state = PL_FW_UPG_FAIL;
		on_firmware_update_complete(current_fw_upg_state);break;
}

}

void init_serial(unsigned char port, unsigned long baud) {

	ser.num = 0;
 	ser.enabled = NO;
	ser.mode = PL_SER_MODE_UART;
	ser.interface = PL_SER_SI_FULLDUPLEX;
	set_baudrate(baud);
	ser.flowcontrol = ENABLED;
	ser.rtsmap = CTS_MAP;
	io.num = CTS_MAP;
	io.enabled = YES;
	ser.ctsmap = RTS_MAP;
	io.num = RTS_MAP;
	io.enabled = NO;
	ser.interchardelay = 0;
	ser.parity = PL_SER_PR_NONE;
	ser.bits = PL_SER_BB_8;
	ser.txbuffrq(4);
	ser.rxbuffrq(sys.freebuffpages-5);
	sys.buffalloc();
	ser.rxclear();
	ser.txclear();
	ser.enabled = YES;

}

void init_receive_socket(string receive_interface) {

	unsigned char prevsock = sock.num;

	sock.num = upgrade_socket_number.upgrade_socket;//Receiving Socket
	if (receive_interface == "wifi") {
		sock.targetinterface = PL_SOCK_INTERFACE_WLN;
	} else if (receive_interface == "ethernet") {
		sock.targetinterface = PL_SOCK_INTERFACE_NET;
	}
	sock.protocol = PL_SOCK_PROTOCOL_TCP;
	sock.inconmode = PL_SOCK_INCONMODE_ANY_IP_ANY_PORT;
	sock.allowedinterfaces = "WLN,NET";
	sock.localportlist = "1000";
	sock.rxbuffrq(sys.freebuffpages-5);
	sock.txbuffrq(1);
	sys.buffalloc();

	sock.num = prevsock;

}

void set_baudrate(unsigned long baudrate) {

	switch (baudrate) {
		case 1200:
ser.baudrate = ser.div9600*8;
		break;
		case 2400:
ser.baudrate = ser.div9600*4;
		break;
		case 4800:
ser.baudrate = ser.div9600*2;
		break;
		case 9600:
ser.baudrate = ser.div9600;
		break;
		case 19200:
ser.baudrate = ser.div9600/2;
		break;
		case 38400:
ser.baudrate = ser.div9600/4;
		break;
		case 56000:
ser.baudrate = ser.div9600/5;
		break;
		case 57600:
ser.baudrate = ser.div9600/6;
		break;
		case 115200:
ser.baudrate = ser.div9600/12;
		break;
		case 128000:
ser.baudrate = ser.div9600/13;
		break;
		case 153600:
ser.baudrate = ser.div9600/16;
		break;
		case 230400:
ser.baudrate = ser.div9600/24;
		break;
		case 256000:
ser.baudrate = ser.div9600/26;
		break;
		case 460800:
ser.baudrate = ser.div9600/48;
		break;
		case 921600:
ser.baudrate = ser.div9600/96;
		break;
	}

}







void device_firmware_read_header() {

	if (device_firmware_bytes_available()>=8) {
		current_fw_upg_state.fw_numfiles = device_firmware_read_32_uint();
		current_fw_upg_state.fw_totalsize = device_firmware_read_32_uint();
		current_fw_upg_state.fw_total_remaining = current_fw_upg_state.fw_totalsize;
		if (current_fw_upg_state.fw_numfiles>0) {
			current_fw_upg_state.state = PL_FW_UPG_READ_FW_TYPE;
		} else {
			current_fw_upg_state.fw_fail_reason = PL_FW_FAIL_NUMFILES;
			current_fw_upg_state.state = PL_FW_UPG_FAIL;
			on_firmware_update_complete(current_fw_upg_state);
		}
	}

}

void device_firmware_read_fw_type() {

	byte(4) l;
	if (device_firmware_bytes_available()>=4) {
		current_fw_upg_state.fw_types(current_fw_upg_state.fw_currentfile) = device_firmware_read_32_uint();

		switch (current_fw_upg_state.fw_types(current_fw_upg_state.fw_currentfile)) {
		case WA2000_MON:

			#IF WLN_AVAILABLE
			wln.setupgraderegion(PL_WLN_UPGRADE_REGION_MONITOR);
			break;
			#ENDIF
		case WA2000_APP:

			#IF WLN_AVAILABLE
			wln.setupgraderegion(PL_WLN_UPGRADE_REGION_MAIN);
			break;
			#ENDIF
		default:break;

		}
		if (current_fw_upg_state.fw_types(current_fw_upg_state.fw_currentfile)<=MANIFEST) {
			current_fw_upg_state.state = PL_FW_UPG_READ_LEN;
		} else {
			current_fw_upg_state.fw_fail_reason = PL_FW_FAIL_INVALID_FW_TYPE;
			current_fw_upg_state.state = PL_FW_UPG_FAIL;
			on_firmware_update_complete(current_fw_upg_state);
		}
	}

}

void device_firmware_read_fw_length() {

	byte(4) l;
	if (device_firmware_bytes_available()>=4) {
		current_fw_upg_state.fw_remaining = device_firmware_read_32_uint();
		if (current_fw_upg_state.fw_remaining>0) {
			current_fw_upg_state.fw_lengths(current_fw_upg_state.fw_currentfile) = current_fw_upg_state.fw_remaining;
			current_fw_upg_state.state = PL_FW_UPG_READ_CHECKSUM;
		} else {
			current_fw_upg_state.fw_fail_reason = PL_FW_FAIL_INVALID_FW_LENGTH;
			current_fw_upg_state.state = PL_FW_UPG_FAIL;
			on_firmware_update_complete(current_fw_upg_state);
		}
	}

}

void device_firmware_read_chekcsum() {

	byte(4) l;
	if (device_firmware_bytes_available()>=4) {
		current_fw_upg_state.fw_checksums(current_fw_upg_state.fw_currentfile) = device_firmware_read_32_uint();
		current_fw_upg_state.state = PL_FW_UPG_READ_FW;
		on_firmware_update_start(current_fw_upg_state);//Let the app know which file will be upgraded. 
	}

}

void device_firmware_write_tios_app(string fw) {
	fd.buffernum = 0;

	if ((current_fw_upg_state.fw_page % 2) == 0) {
		if (current_fw_upg_state.fw_remaining == 0) {
			fw = fw+strgen(FW_UPG_BLK_LEN-len(fw),"\x00");
			fw_buffer = fw;
			fw = "";
			goto set_sector;
		} else {
			fw_buffer = fw;
		}
	} else {
set_sector: 
		if (current_fw_upg_state.fw_remaining == 0) {
			fw = fw+strgen(FW_UPG_BLK_LEN-len(fw),"\x00");
		}
		fd.flush();
		fd.setbuffer(fw_buffer,0);
		fd.setbuffer(fw,128);

		fd.setsector(current_fw_upg_state.fw_sector);
		current_fw_upg_state.fw_sector = current_fw_upg_state.fw_sector+1;
	}

}

void device_firmware_write_wa2000_mon_app(string fw) {
	#IF WLN_AVAILABLE
	wln.writeflashpage(fw);
	#ENDIF
}

void device_firmware_read_manifest(string manifest) {



}


no_yes device_firmware_upload_update() {
no_yes device_firmware_upload_update;

	pat.play("G~",PL_PAT_CANINT);
	// led_upgrade_pattern()
	device_firmware_upload_update = YES;
	switch (current_fw_upg_state.state) {
		case PL_FW_UPG__INIT:

			device_firmware_download_init();
			break;
		case PL_FW_READ_HEADER:

			device_firmware_read_header();
			break;
		case PL_FW_UPG_READ_FW_TYPE:

			device_firmware_read_fw_type();
			break;
		case PL_FW_UPG_READ_LEN:

			device_firmware_read_fw_length();
			break;
		case PL_FW_UPG_READ_CHECKSUM:

			device_firmware_read_chekcsum();
			break;
		case PL_FW_UPG_READ_FW:

			device_firmware_get_fw_block(current_fw_upg_state);
			break;
		case PL_FW_UPG_FAIL:

			on_firmware_update_complete(current_fw_upg_state);
			device_firmware_upload_update = NO;
			break;
		case PL_FW_UPG_CANCEL:

			on_firmware_update_complete(current_fw_upg_state);
			device_firmware_upload_update = NO;
			break;
	}

return device_firmware_upload_update;
}

no_yes device_firmware_upload_async(PL_FW_UPG_SOURCE source, unsigned char number) {
no_yes device_firmware_upload_async;

	device_firmware_init(source,number);//Move parameters below into firmware init
 	device_firmware_upload_async = device_firmware_upload_update();

return device_firmware_upload_async;
}


pl_upg_state_t get_fw_upg_state() {
pl_upg_state_t get_fw_upg_state;

	get_fw_upg_state = current_fw_upg_state;

return get_fw_upg_state;
}


int get_firmware_index(PL_UPG_FW_TYPE fwtype) {
int get_firmware_index;
	int i;
	for (i=0; i <= MAX_NUM_FILE_UPG-1; i++) {
		if (current_fw_upg_state.fw_types(i) == fwtype) {
			get_firmware_index = i;
			return get_firmware_index;
		}
	}
	get_firmware_index = -1;
	return get_firmware_index;
}

unsigned long device_firmware_read_32_uint() {
unsigned long device_firmware_read_32_uint;
	byte(4) l;
	string s;
	switch (current_fw_upg_state.source) {
		case PL_FW_UPG_BLE:


			l = bt.getdata(4);
			break;


		case PL_FW_UPG_WEB:

			sock.num = upgrade_socket_number.http_socket;
			l = sock.getdata(4);
			device_firmware_read_32_uint = l[0]+(l[1] << 8)+(l[2] << 16)+(l[3] << 24);
			break;
		case PL_FW_UPG_SOCK:

			sock.num = upgrade_socket_number.upgrade_socket;
			l = sock.getdata(4);
			device_firmware_read_32_uint = l[0]+(l[1] << 8)+(l[2] << 16)+(l[3] << 24);
			break;
		case PL_FW_UPG_SER:

			ser.num = current_fw_upg_state.source_num;
			l = ser.getdata(4);
			device_firmware_read_32_uint = l[0]+(l[1] << 8)+(l[2] << 16)+(l[3] << 24);
			break;
		case PL_FW_UPG_HTTP:

			l = sock.gethttprqstring(4);
			device_firmware_read_32_uint = l[0]+(l[1] << 8)+(l[2] << 16)+(l[3] << 24);
			break;
		default:
			l[0] = 0;
			l[1] = 0;
			l[2] = 0;
			l[3] = 0;break;
	}
	device_firmware_read_32_uint = l[0]+(l[1] << 8)+(l[2] << 16)+(l[3] << 24);
	return device_firmware_read_32_uint;
}

unsigned long device_firmware_bytes_available() {
unsigned long device_firmware_bytes_available;

	switch (current_fw_upg_state.source) {
		case PL_FW_UPG_WEB:

			sock.num = upgrade_socket_number.http_socket;
			device_firmware_bytes_available = sock.rxlen;
			break;
		case PL_FW_UPG_BLE:

			device_firmware_bytes_available = bt.rxlen;
			break;
		case PL_FW_UPG_SOCK:

			sock.num = upgrade_socket_number.upgrade_socket;
			device_firmware_bytes_available = sock.rxlen;
			break;
		case PL_FW_UPG_SER:

			ser.num = current_fw_upg_state.source_num;
			device_firmware_bytes_available = ser.rxlen;
			break;
		case PL_FW_UPG_HTTP:

			device_firmware_bytes_available = sock.varlen;
			break;
		default:
			device_firmware_bytes_available = 0;break;
	}

return device_firmware_bytes_available;
}


void device_firmware_read_data(string *data, unsigned long *count) {

	switch (current_fw_upg_state.source) {
		case PL_FW_UPG_WEB:

			sock.num = upgrade_socket_number.http_socket;
			*data = sock.getdata(*count);
			break;
		case PL_FW_UPG_BLE:

			*data = bt.getdata(*count);
			break;
		case PL_FW_UPG_SOCK:

			sock.num = upgrade_socket_number.upgrade_socket;
			*data = sock.getdata(*count);
			break;
		case PL_FW_UPG_SER:

			ser.num = current_fw_upg_state.source_num;
			*data = ser.getdata(*count);
			break;
		case PL_FW_UPG_HTTP:

			*data = sock.gethttprqstring(*count);
			break;
		default:
			*data = "";break;
	}

}

void device_firmware_get_fw_block(pl_upg_state_t *dev_fw_upg_state) {
	string fw;
	unsigned char percent_complete, total_percent;
	unsigned long i;
	if (*dev_fw_upg_state.fw_remaining>=FW_UPG_BLK_LEN) {//We have remaining pages for the firmware update
		if (device_firmware_bytes_available()>=FW_UPG_BLK_LEN) {
			device_firmware_read_data(fw,FW_UPG_BLK_LEN);
		}
	} else {//Last block of firmware data
		if (device_firmware_bytes_available()>=*dev_fw_upg_state.fw_remaining) {
			device_firmware_read_data(fw,*dev_fw_upg_state.fw_remaining);
		}
	}

	if (len(fw)>0) {
		unsigned char csdata[128] = fw;
		*dev_fw_upg_state.fw_remaining = *dev_fw_upg_state.fw_remaining-len(fw);
		*dev_fw_upg_state.fw_total_remaining = *dev_fw_upg_state.fw_total_remaining-len(fw);
		for (i=0; i <= len(fw)-1; i++) {
			 *dev_fw_upg_state.fw_checksum = *dev_fw_upg_state.fw_checksum+csdata[i];
		}

		switch (*dev_fw_upg_state.fw_types(current_fw_upg_state.fw_currentfile)) {
		case COMPRESSED_TIOS_APP:
case UNCOMPRESSED_TIOS_APP:
case UNCOMPRESSED_TIOS:

			device_firmware_write_tios_app(fw);
			*dev_fw_upg_state.fw_page = *dev_fw_upg_state.fw_page+1;
			break;
		case WA2000_MON:

			device_firmware_write_wa2000_mon_app(fw);
			break;
		case WA2000_APP:

			device_firmware_write_wa2000_mon_app(fw);
			break;
		case MANIFEST:

			device_firmware_read_manifest(fw);
			break;
		default:break;
			//Ignore the file.
		}

		on_firmware_update_data_received(*dev_fw_upg_state);

		percent_complete = 100-100*(*dev_fw_upg_state.fw_remaining/*dev_fw_upg_state.fw_lengths(*dev_fw_upg_state.fw_currentfile));
		total_percent = 100-(100**dev_fw_upg_state.fw_total_remaining/*dev_fw_upg_state.fw_totalsize);
		if (percent_complete>*dev_fw_upg_state.fw_percent || total_percent>*dev_fw_upg_state.fw_total_percent) {
			*dev_fw_upg_state.fw_percent = percent_complete;
			*dev_fw_upg_state.fw_total_percent = total_percent;
			on_firmware_update_percent_change(*dev_fw_upg_state);
		}

	}
	if (*dev_fw_upg_state.fw_remaining == 0) {

		*dev_fw_upg_state.fw_checksum =  ~ *dev_fw_upg_state;}fw_checksum;
		*dev_fw_upg_state.fw_checksum = *dev_fw_upg_state.fw_checksum+1;

		if (*dev_fw_upg_state.fw_checksum != *dev_fw_upg_state.fw_checksums(*dev_fw_upg_state.fw_currentfile)) {
			*dev_fw_upg_state.fw_fail_reason = PL_FW_FAIL_INVALID_FW_CHECKSUM;
			*dev_fw_upg_state.state = PL_FW_UPG_FAIL;
			return;
		}
		*dev_fw_upg_state.fw_checksum = 0;
		on_firmware_update_file_complete(*dev_fw_upg_state);
		*dev_fw_upg_state.fw_numfiles = *dev_fw_upg_state.fw_numfiles-1;
		*dev_fw_upg_state.fw_currentfile = *dev_fw_upg_state.fw_currentfile+1;
		if (*dev_fw_upg_state.fw_numfiles == 0) {
			*dev_fw_upg_state.state = PL_FW_UPG_COMPLETE;
			on_firmware_update_complete(*dev_fw_upg_state);
		} else {
			*dev_fw_upg_state.state = PL_FW_UPG_READ_FW_TYPE;
			*dev_fw_upg_state.fw_percent = 0;
		}

	
}