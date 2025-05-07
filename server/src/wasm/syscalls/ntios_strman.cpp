/*Copyright 2021 Tibbo Technology Inc.*/

/* INCLUDES */
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <string>
#include <iostream>

#include "base/ntios_types.h"
#include "syscalls/ntios_strman.h"
#include "syscalls/ntios_conv.h"

/* CONSTANTS */
const U16 TB_STRLEN_LIMIT65K = 65535;

const char *const TB_EMPTYSTRING = "";



/* NAMESPACE */
namespace ntios {
namespace strman {
    /* ENUMERATES */
    typedef enum {
        TYPE_AND,
        TYPE_OR,
        TYPE_XOR
    } op_type_enum;



    /* PRIVATE */
    static std::string BitwiseCalc(const std::string &str1_org, \
                                    const std::string &str2_org, \
                                        op_type_enum op_type) {
        /* 
        * Method:
        *   Calculates logical AND on data in str1 and str2 arguments
        * Input:
        *   str1_org: string value
        *   str2_org: string value
        *   op_type_enum: Logical Operand Type (AND, OR, XOR)
        * Remarks:
        *   1. This function treats data in str1 and str2 as two byte arrays. 
        *       Logical AND operation is performed on corresponding byte pairs
        *       (first byte of str1 AND first byte of str2, etc.).
        *   2. If one of the arguments contains less bytes, then this argument
        *       is padded with zeroes prior to performing logical AND operation.
        *   3. At time of this writing (11 augustus 2021), the MAXIMUM allowed
        *       string-length is 65535 (16-bit). If the string-length of 'str1'
        *       and/or 'str2' exceeds 65535, then the output is an empty-string.
        */

        /* Define variables */
        std::string ret;
        std::string str1, str2;
        std::string str1_item, str2_item, str_item_result;
        U8 asc1, asc2, asc_result;
        U16 str_len, str1_len, str2_len;
        U16 diff_len;

        /* Update variables */
        str1 = str1_org;
        str2 = str2_org;

        /* Check if str1 and str2 is not larger than 65535*/
        str1_len = str1.length();
        str2_len = str2.length();

        if (str1_len > TB_STRLEN_LIMIT65K) {
            return TB_EMPTYSTRING;
        }

        if (str2_len > TB_STRLEN_LIMIT65K) {
            return TB_EMPTYSTRING;
        }

        /* 
        * Check if the length of str1 and str2 are the different.
        * If TRUE, then make both strings the same by padding zeros to the
        *   shorter string (str1 or str2).
        */
        if (str1_len < str2_len) {
            /* Calculate the difference in length */
            diff_len = str2_len - str1_len;

            /* Padd zeros */
            for (U16 i = 0; i < diff_len; i++) {
                str1 = str1 + ntios::conv::chr(0);
            }

            /* Update variable */
            str_len = str2_len;
        } else if (str1_len > str2_len) {
            diff_len = str1_len - str2_len;

            /* Padd zeros */
            for (U16 j = 0; j < diff_len; j++) {
                str2 = str2 + ntios::conv::chr(0);
            }

            /* Update variable */
            str_len = str1_len;
        } else {
            /* Update variable */
            str_len = str1_len;
        }

        /* Apply Logical Operand */
        for (U16 k = 0; k < str_len; k++) {
            /* Get string-item which is 1-byte in length */
            str1_item = str1[k];
            str2_item = str2[k];

            /* Convert string to ascii */
            asc1 = ntios::conv::asc(str1_item);
            asc2 = ntios::conv::asc(str2_item);

            if (op_type == TYPE_AND) {
                asc_result = asc1 & asc2;
            } else if (op_type == TYPE_OR) {
                asc_result = asc1 | asc2;
            } else { /* op_type == TYPE_XOR */
                asc_result = asc1 ^ asc2;
            }

            /* Convert the resulting ascii-code back to string */
            str_item_result = ntios::conv::chr(asc_result);

            /* Append to the returning string */
            ret = ret + str_item_result;
        }

        return ret;
    }



    /* PUBLIC */
    U16 insert(std::string &dest_str, \
                const U16 pos, \
                    const std::string &insert_str) {
        /* Define variables */
        std::string str, str_left, str_right;
        std::string insert_str_part;
        U16 dest_str_len;
        U16 insert_str_len;
        U16 str_len, str_left_len, str_right_len;
        U16 diff_len;
        U16 insert_pos;

        /* Get the length of 'dest_str' and 'insert_str' */
        dest_str_len = ntios::strman::len(dest_str);
        insert_str_len = ntios::strman::len(insert_str);

        /* set 'pos = 1' if input is '0' */
        if (pos == 0) {
            insert_pos = 1;
        } else {
            insert_pos = pos;
        }

        /* Get the remaining left length of 'dest_str' */
        str_left_len = insert_pos - 1;
        /* left part of 'dest_str' can NOT exceed 'dest_str_len' */
        if (str_left_len > dest_str_len) {
            str_left_len = dest_str_len;
        }

        /* Get the Left part of 'dest_str' */
        str_left = ntios::strman::left(dest_str, str_left_len);

        /* 
        * Generate the 'new' dest_str:
        *   step 1. Get the difference in length between 'dest_str_len' and 'str_left_len'.
        *   step 2. Get the to-be-inserted part 'insert_str_part' of 'insert_str'
        *   step 2.1. diff_len >= insert_str_len: 'insert_str' can be appended to 'str_left' COMPLETELY.
        *   step 2.2. diff_len < insert_str_len: 'insert_str' can be appended to 'str_left' PARTIALLY.
        *   step 3. update 'str'.
        */
        /* step 1 */
        diff_len = (TB_STRLEN_LIMIT65K - str_left_len);

        /* step 2 */
        if (diff_len >= insert_str_len) {   /* step 2.1 */
            insert_str_part = insert_str;
        } else {    /* step 2.2 */
            insert_str_part = ntios::strman::left(insert_str, diff_len);
        }

        /* step 3 */
        str = str_left + insert_str_part;

        /* 
        * Append the Right part of 'dest_str' to 'str':
        *   step 1. Get the length of 'str'.
        *   step 2. Get the length of the to-be-appended part 'str_right' of 'dest_str'
        *   step 3. Get the to-be-appended part 'str_right'
        *   step 4. update 'str'.
        */
        /* step 1 */
        str_len = ntios::strman::len(str);

        /* step 2 */
        if (str_len < dest_str_len) {
            str_right_len = dest_str_len - str_len;
        } else {
            str_right_len = 0;
        }

        /* step 3 */
        str_right = ntios::strman::right(dest_str, str_right_len);

        /* step 4 */
        str = str + str_right;

        /* Update 'dest_str' (because of byref) */
        dest_str = str;

        /* Output length */
        return ntios::strman::len(str);
    }

    no_yes isNumeric(const string &sourcestr) {
        for (U32 i = 0; i < len(sourcestr); i++) {
            if (isdigit(sourcestr[i]) == (U8)false) {
                return NO;
            }
        }

        /* Output */
        return YES;
    }

    U16 len(const std::string &sourcestr) {
        return sourcestr.length();
    }

    std::string left(const std::string &sourcestr, U16 len) {
        return sourcestr.substr(0, len);
    }

    std::string mid(const std::string &sourcestr, U16 frompos, U16 len) {
        U16 frompos_prevchar;

        /* move-back one character */
        if (frompos > 0) {
            frompos_prevchar = frompos - 1;
        } else {
            frompos_prevchar = 0;
        }

        if (frompos <= sourcestr.length()) {
            return sourcestr.substr(frompos_prevchar, len);
        } else {
            return TB_EMPTYSTRING;
        }
    }

    std::string right(const std::string &sourcestr, U16 len) {
        U16 startpos = sourcestr.length() - len;

        return sourcestr.substr(startpos, len);
    }

    U16 instr(U16 frompos, const std::string &sourcestr, \
            const std::string &substr, U16 num) {
        /* Define variables */
        U16 pos;
        U16 numof_occur = 0;

        /*
        * Deduct 'frompos' by '1'
        * Remark:
        *   This is necessary because the 'find' library starts at position '0', 
        *   and this method's 'frompos' starts at position '1'.
        */
        if (frompos > 0) {
            frompos--;
        }

        /* 
        * Keep on looping until the specified 
        * number of occurrence 'num' is reached.
        */
        while (numof_occur < num) {
            /*
            * Find the 'pos' of 'substr' in 'sourcestr'.
            * Remark:
            *   If NO occurrence is found, then pos = 255.
            */
            pos = sourcestr.find(substr, frompos);

            /* 
            * Check if 'substr' is found in 'sourcestr' 
            * If TRUE, then increment 'num_found' by '1'
            */
            if (pos != 255) {
                numof_occur++;
                pos++;
                frompos = pos + substr.length();
            } else {
                pos = 0;

                break;
            }
        }

        /* Output */
        return pos;
    }

    U16 ninstr(const std::string &sourcestr, const std::string &substr) {
        /* Define variables */
        U16 pos = 0;
        U16 frompos = 0;
        U16 numof_occur = 0;

        /* 
        * Keep on looping until the specified 
        * number of occurrence 'num' is reached.
        */
        while (pos != 255) {
            /*
            * Find the 'pos' of 'substr' in 'sourcestr'.
            * Remark:
            *   If NO occurrence is found, then pos = 255.
            */
            pos = sourcestr.find(substr, frompos);

            /* 
            * Check if 'substr' is found in 'sourcestr' 
            * If TRUE, then increment 'num_found' by '1'
            */
            if (pos != 255) {
                numof_occur++;
                pos++;

                frompos = pos + substr.length();
            } else {
                break;
            }
        }

        /* Output */
        return numof_occur;
    }

    std::string random(U16 len) {   /* Flawfinder: ignore */
        /* Define variables */
        std::string ret;
        std::string rand_str;
        U8 rand_num;
        U32 seed;

        /* Initialization */
        /* 
        * Remark:
        *   time(NULL) returns the current calendar time (in seconds since Jan 1, 1970).
        */
        seed = time(NULL);
        for (U16 i = 0; i < len; i++) {
            rand_num = rand_r(&seed);

            /* Convert 'rand_num' to 'chr' */
            rand_str = ntios::conv::chr(rand_num);

            /* Add 'rand_str' to 'ret' */
            ret = ret + rand_str;
        }

        /* Output */
        return ret;
    }

    std::string strgen(const U16 len, const std::string &substr) {
        /* Define variables */
        std::string str;
        U16 str_len;
        U16 substr_len;
        U16 len_diff;

        /* Check if substr is an empty string */
        if (substr == TB_EMPTYSTRING) {
            return TB_EMPTYSTRING;
        }

        /* Update variables */
        substr_len = ntios::strman::len(substr);

        /* Initialize variables */
        str = TB_EMPTYSTRING;
        str_len = 0;

        /* Generate string */
        while (str_len < len) {
            /* length of 'str' is less than the specified length 'len' */
            if (len < substr_len) {
                str = ntios::strman::left(substr, len);

            /* for all other cases */
            } else {
                /* 
                * Get the difference between the specified length 'len' and 
                * current the current length of string 'str'.
                */
                len_diff = len - str_len;
                /* length difference 'len_diff' is greater than 'substr_len' */
                if (len_diff >= substr_len) {
                    /* append the complete 'substr' to 'str; */
                    str = str + substr;
                } else {    /* len_diff < substr_len */
                    /* append a part of 'substr' to 'str; */
                    str = str + left(substr, len_diff);
                }
            }

            /* Get the current length of 'str' */
            str_len = ntios::strman::len(str);
        }

        /* Output */
        return str;
    }

    std::string strand(const std::string &str1, const std::string &str2) {
        return BitwiseCalc(str1, str2, TYPE_AND);
    }

    std::string stror(const std::string &str1, const std::string &str2) {
        return BitwiseCalc(str1, str2, TYPE_OR);
    }

    std::string strxor(const std::string &str1, const std::string &str2) {
        return BitwiseCalc(str1, str2, TYPE_XOR);
    }

}  // namespace strman
}  // namespace ntios
