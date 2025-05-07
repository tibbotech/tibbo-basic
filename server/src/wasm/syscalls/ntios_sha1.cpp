/*Copyright 2021 Tibbo Technology Inc.*/

/* INCLUDES */
#include <cstring>  /* required for strlen */
#include <string>
#include <iostream>

#include "base/ntios_types.h"
#include "syscalls/ntios_conv.h"
#include "syscalls/ntios_strman.h"
#include "syscalls/ntios_sha1.h"



/* GLOBAL VARIABLES */
sha1_ctx sha1_ctx_bckup;
const char *bckup_hash_ptr;
U32 bckup_str_len;



/* NAME SPACE */
namespace ntios {
namespace sha1 {
    /*
    *********************************************************************
    * BASED ON RFC-1321: https://datatracker.ietf.org/doc/html/rfc1321
    *********************************************************************
    */
    /* CONSTANTS */
    const U32 TB_NULL = 0x00;
    const U16 TB_STRLEN_LIMIT65K = 65535;
    const U8 TB_HASH_LIMIT_20 = 20;
    const char *const TB_EMPTYSTRING = "";

    /* VARIABLES */
    block_union block[0];


    /* MACROS */
    #define rol(value, bits) (((value) << (bits)) | ((value) >> (32 - (bits))))

    /* blk0() and blk() perform the initial expand. */
    /* I got the idea of expanding during the round function from SSLeay */
    #if BYTE_ORDER == LITTLE_ENDIAN
        #define blk0(i) (block->len_arr[i] = \
                            rol(block->len_arr[i], 24)&0xFF00FF00| \
                            rol(block->len_arr[i], 8)&0x00FF00FF \
                        )
    #elif BYTE_ORDER == BIG_ENDIAN
        #define blk0(i) block->len_arr[i]
    #else
        #error "Endianness not defined!"
    #endif

    #define blk(i) (block->len_arr[i&15] = \
                        rol(block->len_arr[(i+13)&15]^ \
                        block->len_arr[(i+8)&15]^ \
                        block->len_arr[(i+2)&15]^ \
                        block->len_arr[i&15], 1) \
                    )

    /* (R0+R1), R2, R3, R4 are the different operations used in SHA1 */
    #define R0(v, w, x, y, z, i) (z += ((w&(x^y))^y) + \
                                    blk0(i) + \
                                    0x5A827999 + \
                                    rol(v, 5)); \
                                    (w = rol(w, 30));
    #define R1(v, w, x, y, z, i) (z += ((w&(x^y))^y) + \
                                    blk(i) + \
                                    0x5A827999 + \
                                    rol(v, 5)); \
                                    (w = rol(w, 30));
    #define R2(v, w, x, y, z, i) (z += (w^x^y) + \
                                    blk(i) + \
                                    0x6ED9EBA1 + \
                                    rol(v, 5)); \
                                    (w = rol(w, 30));
    #define R3(v, w, x, y, z, i) (z += (((w|x)&y)|(w&x)) + \
                                    blk(i) + \
                                    0x8F1BBCDC + \
                                    rol(v, 5)); \
                                    (w = rol(w, 30));
    #define R4(v, w, x, y, z, i) (z += (w^x^y) + \
                                    blk(i) + \
                                    0xCA62C1D6 + \
                                    rol(v, 5)); \
                                    (w = rol(w, 30));



    /***********/
    /* PRIVATE */
    /***********/

    /* PRE-DEFINED FUNCTIONS */
    static void hmemcpy(void *dst_input, void *src_input, size_t n);
    static void hmemset(void *dst_output, U32 src_input, size_t len_input);
    static U8* string_to_u8ptr(const std::string &str);
    static void sha1_transform(U32 state[5], const U8 buffer[64]);
    static void sha1_init(sha1_ctx * input_ctx);
    static void sha1_update(sha1_ctx *input_ctx, U8 *input, size_t input_len);
    static void sha1_finish(sha1_ctx * input_ctx, U8 digest[TB_HASH_LIMIT_20]);
    static void bckup_variables_init();
    static std::string sha1_calc(const std::string &input, \
                                    const std::string &input_hash, \
                                        sha1_modes sha1_mode, \
                                            size_t total_len);



    /* FUNCTIONS */
    static void hmemcpy(void *dst_output, void *src_input, size_t len_input) {
        /* Type Cast */
        /*
        * Convert type of pointers 'src_input' and 'dst_input'
        * to another pointer of type 'char' respectively.
        */
        char *src_arr = reinterpret_cast<char *>(src_input);
        char *dst_arr = reinterpret_cast<char *>(dst_output);

        /* Copy contents of src_arr[] to dst_arr[] */
        for (U32 i = 0; i < len_input; i++) {
            dst_arr[i] = src_arr[i];
        }
    }

    static void hmemset(void *dst_output, U32 src_input, size_t len_input) {
        /* Convert type of pointer 'dst_output' to 'U8 pointer' */
        U8 *dst_arr = reinterpret_cast<U8 *>(dst_output);

        /* Convert 'U32' to 'U8' */
        U8 src_conv =  static_cast<U32>(src_input);

        /* Assign value 'src_conv' to 'dst_arr[]' */
        for (U32 i = 0; i < len_input; i++) {
            dst_arr[i] = src_conv;
        }
    }

    static U8* string_to_u8ptr(const std::string &str) {
        /* Convert from 'string' to 'const char pointer' */
        const char *str_ptr = str.c_str();

        /* Convert from 'char pointer' to 'unsighed char pointer' */
        char *str_arr = const_cast<char*>(str_ptr);

        /* Output */
        return reinterpret_cast<U8*>(str_arr);
    }

    /* Hash a single 512-bit block. This is the core of the algorithm. */
    static void sha1_transform(U32 state[5], U8 buffer[64]) {
        /* Define variables */
        U32 a, b, c, d, e;

        /*
        * void *hmemcpy( void *dest, const void *src, std::size_t count );
        * Input:
        *   dest: pointer to the memory location to copy to
        *   src: pointer to the memory location to copy from
        *   count: number of bytes to copy
        * Output:
        *   value of dest
        */
        /* Copy 'buffer' to 'block', 64 bytes*/
        hmemcpy(block, buffer, 64);

        /* Copy input_ctx->state[] to working vars */
        a = state[0];
        b = state[1];
        c = state[2];
        d = state[3];
        e = state[4];

        /* 4 rounds of 20 operations each. Loop unrolled. */
        R0(a, b, c, d, e, 0);
        R0(e, a, b, c, d, 1);
        R0(d, e, a, b, c, 2);
        R0(c, d, e, a, b, 3);
        R0(b, c, d, e, a, 4);
        R0(a, b, c, d, e, 5);
        R0(e, a, b, c, d, 6);
        R0(d, e, a, b, c, 7);
        R0(c, d, e, a, b, 8);
        R0(b, c, d, e, a, 9);
        R0(a, b, c, d, e, 10);
        R0(e, a, b, c, d, 11);
        R0(d, e, a, b, c, 12);
        R0(c, d, e, a, b, 13);
        R0(b, c, d, e, a, 14);
        R0(a, b, c, d, e, 15);

        R1(e, a, b, c, d, 16);
        R1(d, e, a, b, c, 17);
        R1(c, d, e, a, b, 18);
        R1(b, c, d, e, a, 19);
        R2(a, b, c, d, e, 20);
        R2(e, a, b, c, d, 21);
        R2(d, e, a, b, c, 22);
        R2(c, d, e, a, b, 23);
        R2(b, c, d, e, a, 24);
        R2(a, b, c, d, e, 25);
        R2(e, a, b, c, d, 26);
        R2(d, e, a, b, c, 27);
        R2(c, d, e, a, b, 28);
        R2(b, c, d, e, a, 29);
        R2(a, b, c, d, e, 30);
        R2(e, a, b, c, d, 31);
        R2(d, e, a, b, c, 32);
        R2(c, d, e, a, b, 33);
        R2(b, c, d, e, a, 34);
        R2(a, b, c, d, e, 35);
        R2(e, a, b, c, d, 36);
        R2(d, e, a, b, c, 37);
        R2(c, d, e, a, b, 38);
        R2(b, c, d, e, a, 39);

        R3(a, b, c, d, e, 40);
        R3(e, a, b, c, d, 41);
        R3(d, e, a, b, c, 42);
        R3(c, d, e, a, b, 43);
        R3(b, c, d, e, a, 44);
        R3(a, b, c, d, e, 45);
        R3(e, a, b, c, d, 46);
        R3(d, e, a, b, c, 47);
        R3(c, d, e, a, b, 48);
        R3(b, c, d, e, a, 49);
        R3(a, b, c, d, e, 50);
        R3(e, a, b, c, d, 51);
        R3(d, e, a, b, c, 52);
        R3(c, d, e, a, b, 53);
        R3(b, c, d, e, a, 54);
        R3(a, b, c, d, e, 55);
        R3(e, a, b, c, d, 56);
        R3(d, e, a, b, c, 57);
        R3(c, d, e, a, b, 58);
        R3(b, c, d, e, a, 59);

        R4(a, b, c, d, e, 60);
        R4(e, a, b, c, d, 61);
        R4(d, e, a, b, c, 62);
        R4(c, d, e, a, b, 63);
        R4(b, c, d, e, a, 64);
        R4(a, b, c, d, e, 65);
        R4(e, a, b, c, d, 66);
        R4(d, e, a, b, c, 67);
        R4(c, d, e, a, b, 68);
        R4(b, c, d, e, a, 69);
        R4(a, b, c, d, e, 70);
        R4(e, a, b, c, d, 71);
        R4(d, e, a, b, c, 72);
        R4(c, d, e, a, b, 73);
        R4(b, c, d, e, a, 74);
        R4(a, b, c, d, e, 75);
        R4(e, a, b, c, d, 76);
        R4(d, e, a, b, c, 77);
        R4(c, d, e, a, b, 78);
        R4(b, c, d, e, a, 79);

        /* Add the working vars back into input_ctx.state[] */
        state[0] += a;
        state[1] += b;
        state[2] += c;
        state[3] += d;
        state[4] += e;

        /* Reset 'block' */
        hmemset(block, TB_NULL, sizeof(block));
    }

    /* sha1_init - Initialize new input_ctx */
    static void sha1_init(sha1_ctx * input_ctx) {
        /* SHA1 initialization constants */
        input_ctx->count[0] = 0;
        input_ctx->count[1] = 0;
        input_ctx->state[0] = 0x67452301;
        input_ctx->state[1] = 0xEFCDAB89;
        input_ctx->state[2] = 0x98BADCFE;
        input_ctx->state[3] = 0x10325476;
        input_ctx->state[4] = 0xC3D2E1F0;
    }

    /* Run your input through this. */
    static void sha1_update(sha1_ctx *input_ctx, U8 *input, size_t input_len) {
        /*
        * Input:
        *   input_ctx: input_ctx
        *   input: input block
        *   input_len: input block length
        */
        /* Define and Init variables */
        U32 i = 0;
        U32 index = 0;
        U32 partlen = 0;

        /* Compute number of bytes mod 64 */
        index = (input_ctx->count[0] >> 3) & 0x3F;

        /* Update number of bits */
        input_ctx->count[0] += input_len << 3;
        if (input_ctx->count[0] < (input_len << 3)) {
            input_ctx->count[1]++;
        }
        input_ctx->count[1] += input_len >> 29;

        /* 
        * Transform as many times as possible.
        */ 
        partlen = 64 - index;
        if (input_len >= partlen) {
            /* Copy 'input' to 'buffer'*/
            hmemcpy(&input_ctx->buffer[index], \
                    input, partlen);
            sha1_transform(input_ctx->state, input_ctx->buffer);

            for (i = partlen; \
                    i + 64 <= input_len;
                        i += 64) {
                sha1_transform(input_ctx->state, &input[i]);
            }

            index = 0;
        } else {
            i = 0;
        }



        /* Remainder: Copy 'input' to 'buffer'*/
        hmemcpy(&input_ctx->buffer[index], \
                &input[i], \
                    input_len - i);
    }

    /* Add padding and return the message digest. */
    static void sha1_finish(sha1_ctx * input_ctx, U8 digest[TB_HASH_LIMIT_20]) {
        U32 i;
        U8 bits[8];
        U8 c;

        for (i = 0; i < 8; i++) {
            bits[i] = (U8) ((input_ctx->count[(i >= 4 ? 0 : 1)] >> \
                                ((3 - (i & 3)) * 8)) & \
                                    0xFF);
        }

        c = 0200;
        sha1_update(input_ctx, &c, 1);

        while ((input_ctx->count[0] & 504) != 448) {
            c = 0000;
            sha1_update(input_ctx, &c, 1);
        }

        sha1_update(input_ctx, bits, 8); /* Should cause a sha1_transform() */

        for (i = 0; i < TB_HASH_LIMIT_20; i++) {
            digest[i] = (U8) ((input_ctx->state[i >> 2]) >> \
                                (((3 - (i & 3)) * 8)) & \
                                    0xFF);
        }

        /* Reset variables */
        hmemset(input_ctx, TB_NULL, sizeof(*input_ctx));
        hmemset(&bits, TB_NULL, sizeof(bits));
    }

    static void bckup_variables_init() {
        sha1_ctx_bckup = {0};
        bckup_hash_ptr = TB_EMPTYSTRING;
        bckup_str_len = 0;
    }

    static std::string sha1_calc(const std::string &input, \
                                    const std::string &input_hash, \
                                        sha1_modes sha1_mode, \
                                            size_t total_len) {
        /*
        Method:
            Generates SHA1 hash on the specified string input 'str'.
        Input:
        - str: string containing (the next portion of) the input 
                data to generate SHA1 hash on.
            Remarks:
            1. Maximum String-length is 65535. If the length is exceeded, 
                then this will result in an Error and the function will 
                return an Empty String. 
            2. sha1_mode = 0- SHA1_UPDATE → String-length must be Divisible 
                by 64 (e.g. 64, 128, 192, etc. characters in length).
                
                *NOTE*: any other length will result in an Error, and the 
                    function will return an Empty String. 
            3. sha1_mode= 1- SHA1_FINISH → this string can have any length 
                (up to 65535 characters).
        - input_hash: hash obtained as a result of SHA1 calculation on 
                the previous data portion. 
                
                *IMPORTANT*:
                1. (MUST) Set to Empty String for the FIRST PORTION of data.
                2. (MUST) Use the Result of the previous SHA1 calculation 
                    for the second and all subsequent portions of data.
                3. The result of SHA1 is ALWAYS 16 characters long. 
                
                Remarks: 
                1. passing an input_hash of any other length 
                    (e.g. input_hash = "1"), except for an Empty String, will 
                    result in Error; this function will return an Empty String.
                2. passing an input_hash of 20 characters long, but NOT from 
                    the result of the previous SHA1 calculation, will result in the
                    return of an EMPTY STRING.
                3. using the input_hash of the previous calculation is important, 
                    because this value can be used to validate whether the 
                    SHA1-calculation is being done on the same string 'str' or not. 
        - sha1_mode: 
            0- SHA1_UPDATE : Set this mode for all data portions except for:
                1. the Last data portion (see SHA1_FINISH)
                2. if you have a single data portion (see SHA1_FINISH)
            1- SHA1_FINISH: The SHA1 calculation ALWAYS ENDS with this mode.
                    When to use this mode?
                      1. when calculating the Last Data Portion
                      2. In case we only have a SINGLE DATA Portion.
                
                *NOTE*: in this case, set the input_hash as an Empty String.
        - total_len: total length of processed data (of all data portions combined). 
            Remarks:
            1. Only relevant when sha1_mode = 1- SHA1_FINISH. 
            2. Only relevant for the last or a single data portion.
            3. If the input total length does NOT match the 'real' total length 
                of the processed data, then this will result in the
                    return of an EMPTY STRING.
        Output:
            20-character hash string
        Remarks:
            1. SHA1 is a standard method of calculating hash codes on data of any size. 
            2. The amount of input data can often exceed the maximum capacity of 
                string variables (65535 characters). The sha1 method can be invoked 
                repeatedly in order to process the data of any size (see the example below).
        */

        /* Define variables */
        sha1_ctx input_ctx;
        U8 *input_hex;
        U8 hash_arr[TB_HASH_LIMIT_20];
        U8 hash_arr_item;
        U32 input_hash_len;
        U32 input_hex_len, input_hex_len_mod;
        std::string hash_output, hash_str_item;
        const char *input_hash_ptr;

        /* Convert String 'input' to 'const char*' */
        input_hash_ptr = input_hash.c_str();

        /*
        * When reading string 'input', for each character,
        *   convert from 'const char*' to 'U8'
        */
        input_hex = string_to_u8ptr(input);

        /* Get string-length of 'input' */
        input_hex_len = ntios::strman::len(input);

        /* 
        * Check if string-length of 'input' exceeds the maximum allowed 
        *   number of characters (65535)
        */
        if (input_hex_len > TB_STRLEN_LIMIT65K) {
            bckup_variables_init();

            return TB_EMPTYSTRING;
        }

        /* 
        * Validate string-length modulus
        * Must be divisible by 64 for sha1_mode = SHA1_UPDATE
        */
        if (sha1_mode == SHA1_UPDATE) {
            /* Get modulus value */
            input_hex_len_mod = (input_hex_len%64);

            /* In case NOT divisible by 64, then return an EMPTYSTRING */
            if (input_hex_len_mod != 0) {
            bckup_variables_init();

            return TB_EMPTYSTRING;
            }
        }

        /* INIT */
        if (input_hash == TB_EMPTYSTRING) {
            /* initialize 'input_ctx' */
            sha1_init(&input_ctx);

            /* Initialize backup variables */
            bckup_variables_init();
        } else {
            /* Get the length of 'input_hash' */
            input_hash_len = ntios::strman::len(input_hash);

            /* 
            * Validate 'input_hash' string-length 
            */
            /* 20 characters long */
            if (input_hash_len == TB_HASH_LIMIT_20) {
                /* input value does NOT match the backup value */
                if ((input_hash_ptr) != bckup_hash_ptr) {
                    bckup_variables_init();

                    return TB_EMPTYSTRING;
                }

            /* Not 20 characters long */
            } else {
                bckup_variables_init();

                return TB_EMPTYSTRING;
            }

            /* 
            * Update current context 'input_ctx' with the backed up context 'sha1_ctx_bckup'
            */
            input_ctx = sha1_ctx_bckup;
        }

        /*
        * Backup string-length of 'input'
        * Remark:
        *   This is important because it will be used for 
        *   the END-validation when sha1_mode = SHA1_FINISH
        */
        bckup_str_len = bckup_str_len + input_hex_len;

        /*
        * Validate the total length of processed data
        */
        if (sha1_mode == SHA1_FINISH) {
            if (total_len != bckup_str_len) {
                bckup_variables_init();

                return TB_EMPTYSTRING;
            }
        }

        /* UPDATE */
        /*
        * MD5 block update operation. Continues an MD5 message-digest operation,
        * processing another message block, and updating the input_ctx.
        */
        sha1_update(&input_ctx, input_hex, input_hex_len);

        /* Backup context */
        if (sha1_mode == SHA1_UPDATE) {
            sha1_ctx_bckup = input_ctx;
        }

        /* FINISH */
        /*
        * MD5 finalization. Ends an MD5 message-digest operation, writing the
        * the message digest and zeroizing the input_ctx.
        */
        if (sha1_mode == SHA1_FINISH) {
            sha1_finish(&input_ctx, hash_arr);

            bckup_variables_init();
        }



        /*
        * Convert Hex to String
        * Remark:
        *   Variable 'hash_arr' contains 16 hex-values
        */
        hash_output = TB_EMPTYSTRING;    /* Initialize */
        for (U8 i = 0; i < TB_HASH_LIMIT_20; i++) {
            /* Get each asc-value */
            hash_arr_item = hash_arr[i];

            /* Convert Hex to String */
            hash_str_item = ntios::conv::chr(hash_arr_item);

            /* Add to output variable */
            hash_output = hash_output + hash_str_item;
        }



        /* Backup 'hash_output' */
        if (sha1_mode == SHA1_UPDATE) {
            bckup_hash_ptr = hash_output.c_str();
        }



        /* Output */
        return hash_output;
    }



    /**********/
    /* PUBLIC */
    /**********/
    std::string sha1(const std::string &str, \
                        const std::string &input_hash, \
                            sha1_modes sha1_mode, \
                                size_t total_len) {
        return sha1_calc(str, input_hash, sha1_mode, total_len);
    }

}  // namespace sha1
}  // namespace ntios
