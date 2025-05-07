/*Copyright 2021 Tibbo Technology Inc.*/

/*
This is an implementation of the AES algorithm, specifically ECB, CTR and CBC mode.
Block size can be chosen in aes.h - available choices are AES128, AES192, AES256.
The implementation is verified against the test_passing_array vectors in:
  National Institute of Standards and Technology Special Publication 800-38A 2001 ED
ECB-AES128
----------
  plain-text:
    6bc1bee22e409f96e93d7e117393172a
    ae2d8a571e03ac9c9eb76fac45af8e51
    30c81c46a35ce411e5fbc1191a0a52ef
    f69f2445df4f9b17ad2b417be66c3710
  key:
    2b7e151628aed2a6abf7158809cf4f3c
  resulting cipher
    3ad77bb40d7a3660a89ecaf32466ef97 
    f5d3d58503b9699de785895a96fdbaaf 
    43b1cd7f598ece23881b00e3ed030688 
    7b0c785e27e8ad3f8223207104725dd4 
NOTE:   String length must be evenly divisible by 16byte (str_len % 16 == 0)
        You should pad the end of the string with zeros if this is not the case.
        For AES192/256 the key size is proportionally larger.
*/



/* INCLUDES */
#include <iostream>
#include <cstring>
#include <string>

#include "base/ntios_types.h"
#include "syscalls/ntios_aes.h"
#include "syscalls/ntios_conv.h"




/* NAMESPACE */
namespace ntios {
namespace aes {
    /* MACROS */
    /*
    * The number of columns comprising a state in AES.
    * This is a constant in AES. Value=4
    */
    #define Nb 4
    #define HEXNULL 0x00

    #if defined(AES256) && (AES256 == 1)
        #define Nk 8
        #define Nr 14
    #elif defined(AES192) && (AES192 == 1)
        #define Nk 6
        #define Nr 12
    #else
        #define Nk 4        /* The number of 32 bit words in a key. */
        #define Nr 10       /* The number of rounds in AES Cipher. */
    #endif

    /*
    * jcallan@github points out that declaring Multiply as a function
    * reduces code size considerably with the Keil ARM compiler.
    * See this link for more information: https://github.com/kokke/tiny-AES-C/pull/3
    */
    #ifndef MULTIPLY_AS_A_FUNCTION
        #define MULTIPLY_AS_A_FUNCTION 0
    #endif

    /*
    * Defined to be used in 'SubBytes' and 'InvSubBytes'
    */
    #define getSBoxValue(num) (Sbox[(num)])
    #define getSBoxInvert(num) (InvSbox[(num)])



    /* CONSTANTS */
    const U8 BLOCKSIZE_16 = 16; /* BYTES */
    const U8 BLOCKSIZE_32 = 32; /* BYTES */

    const char *const XCRYPT_ENCRYPT = "ENCRYPT";
    const char *const XCRYPT_DECRYPT = "DECRYPT";

    const char *const TB_EMPTYSTRING = "";
    const char *const TITLE_KEY = "KEY";
    const char *const TITLE_PLAIN_TEXT = "PLAIN TEXT";
    const char *const TITLE_XCRYPT_TEXT = "XCRYPT TEXT";
    const char *const TITLE_ENCRYPTED_HEX = "ENCRYPTED HEX";
    const char *const TITLE_DECRYPTED_HEX = "DECRYPTED HEX";
    const char *const TITLE_ENCRYPTED_STRING = "ENCRYPTED STRING";
    const char *const TITLE_DECRYPTED_STRING = "DECRYPTED STRING";



    /* ARRAY (4x4) */
    /* state - array holding the intermediate results during decryption. */
    typedef U8 state_t[4][4];



    /* (INV) SUBSTITUTION BOX */
    /*
    * The lookup-tables are marked const so they can be placed in read-only storage instead of RAM.
    * The numbers below can be computed dynamically trading ROM for RAM.
    * This can be useful in (embedded) bootloader applications where ROM is often limited.
    */
    static const U8 Sbox[256] = {
    /*    0     1    2      3     4    5     6     7 (1st row) */
        0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5,
    /*        8    9     A      B    C     D     E     F (2nd row) */
            0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76, \
        0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0,
            0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0, \
        0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc,
            0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15, \
        0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a,
            0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75, \
        0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0,
            0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84, \
        0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b,
            0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf, \
        0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85,
            0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8, \
        0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5,
            0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, \
        0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17,
            0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73, \
        0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88,
            0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb, \
        0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c,
            0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79, \
        0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9,
            0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08, \
        0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6,
            0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a, \
        0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e,
            0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e, \
        0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94,
            0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf, \
        0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68,
            0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16};

    static const U8 InvSbox[256] = {
        0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, \
            0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
        0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, \
            0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb,
        0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, \
            0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
        0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, \
            0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25,
        0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, \
            0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92,
        0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, \
            0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
        0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, \
            0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06,
        0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, \
            0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b,
        0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, \
            0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
        0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, \
            0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e,
        0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, \
            0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b,
        0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, \
            0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
        0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, \
            0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f,
        0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, \
            0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef,
        0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, \
            0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
        0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, \
            0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d };

    /*
    * The round constant word array, RoundConstArr[i], contains the values given by x to the power (i-1)...
    * ...being powers of x (x is denoted as {02}) in the field GF(2^8).
    */
    static const U8 RoundConstArr[11] = {0x8d, 0x01, 0x02, 0x04, 0x08, \
                                        0x10, 0x20, 0x40, 0x80, 0x1b, 0x36};

    /*
    * Jordan Goulder points out in PR #12 (https://github.com/kokke/tiny-AES-C/pull/12),
    * that you can remove most of the elements in the RoundConstArr array, because they are unused.
    *
    * From Wikipedia's article on the Rijndael key schedule @ https://en.wikipedia.org/wiki/Rijndael_key_schedule#RoundConstArr
    * 
    * "Only the first some of these constants are actually used – up to rcon[10] for AES-128 (as 11 round keys are needed), 
    *  up to rcon[8] for AES-192, up to rcon[7] for AES-256. rcon[0] is not used in AES algorithm."
    */



    /*
    %%%%%%%%%%%%%%%%%%%%%%%%% 
    % PRE-DEFINED FUNCTIONS %
    %%%%%%%%%%%%%%%%%%%%%%%%%
    */
    static void KeyExpansion(U8* RoundKey, const U8* Key);
    static void AES_ctx_init(struct AES_ctx_struct* ctx, const U8* key);
    static void AddRoundKey(U8 round, state_t* state, const U8* RoundKey);
    static void SubBytes(state_t* state);
    static void ShiftRows(state_t* state);
    static U8 xtime(U8 x);
    static void MixColumns(state_t* state);
    static void InvMixColumns(state_t* state);
    static void InvSubBytes(state_t* state);
    static void InvShiftRows(state_t* state);
    static void Cipher(state_t *state_2darr, const U8 *RoundKey);
    static void InvCipher(state_t* state_2darr, const U8* RoundKey);
    static void AES_Xcrypt(U8 *key_1darr_in, \
                                    U8 *data_1darr_in, \
                                        const U8 &data_1darr_len_in, \
                                            const char *const xcrypt_type);
    static std::string AES_Ecb_Handler(const std::string &key, \
                                        const std::string &strdata, \
                                            const char *const xcrypt_type);
    static U8 CalcPaddLen(const U8 &org_len, const U8 &block_size);
    static void Arr_Str2Hex(const std::string &str_in, U8 *arr_out, \
                                const U8 &org_len, const U8 &padd_len, \
                                    const U8 &block_size);
    static std::string Arr_Hex2Str(U8 *arr_in_ptr, \
                                    const U8 &padd_len, \
                                        const char *const xcrypt_type);



    /*
    %%%%%%%%%%%%%%%%%%%%%
    % PRIVATE FUNCTIONS %
    %%%%%%%%%%%%%%%%%%%%%
    */
    /* This function produces Nb(Nr+1) round keys.
    * The round keys are used in each round to decrypt the states.
    * Used by 'AES_ctx_init' and 'AES_init_ctx_iv'.
    */
    static void KeyExpansion(U8* RoundKey, const U8* Key) {
        U8 i, j, k;
        U8 tempa[4];   /* Used for the column/row operations */
        /* The first round key is the key itself. */
        for (i = 0; i < Nk; ++i) {
            RoundKey[(i * 4) + 0] = Key[(i * 4) + 0];
            RoundKey[(i * 4) + 1] = Key[(i * 4) + 1];
            RoundKey[(i * 4) + 2] = Key[(i * 4) + 2];
            RoundKey[(i * 4) + 3] = Key[(i * 4) + 3];
        }

        /* All other round keys are found from the previous round keys. */
        for (i = Nk; i < Nb * (Nr + 1); ++i) {
            {
                k = (i - 1) * 4;
                tempa[0] = RoundKey[k + 0];
                tempa[1] = RoundKey[k + 1];
                tempa[2] = RoundKey[k + 2];
                tempa[3] = RoundKey[k + 3];
            }

            if (i % Nk == 0) {
                /*
                * This function shifts the 4 bytes in a word to the left once.
                * [a0,a1,a2,a3] becomes [a1,a2,a3,a0]
                */

                /*
                * Function RotWord()
                */
                {
                    const U8 u8tmp = tempa[0];
                    tempa[0] = tempa[1];
                    tempa[1] = tempa[2];
                    tempa[2] = tempa[3];
                    tempa[3] = u8tmp;
                }

                /*
                * SubWord() is a function that takes a four-byte input word and
                * applies the S-box to each of the four bytes to produce an output word.
                */

                /*
                Function Subword()
                */
                {
                    tempa[0] = getSBoxValue(tempa[0]);
                    tempa[1] = getSBoxValue(tempa[1]);
                    tempa[2] = getSBoxValue(tempa[2]);
                    tempa[3] = getSBoxValue(tempa[3]);
                }

                tempa[0] = tempa[0] ^ RoundConstArr[i/Nk];
            }

            #if defined(AES256) && (AES256 == 1)
                if (i % Nk == 4) {
                    /*
                    Function Subword()
                    */
                    {
                        tempa[0] = getSBoxValue(tempa[0]);
                        tempa[1] = getSBoxValue(tempa[1]);
                        tempa[2] = getSBoxValue(tempa[2]);
                        tempa[3] = getSBoxValue(tempa[3]);
                    }
                }
            #endif

            j = i * 4;
            k = (i - Nk) * 4;
            RoundKey[j + 0] = RoundKey[k + 0] ^ tempa[0];
            RoundKey[j + 1] = RoundKey[k + 1] ^ tempa[1];
            RoundKey[j + 2] = RoundKey[k + 2] ^ tempa[2];
            RoundKey[j + 3] = RoundKey[k + 3] ^ tempa[3];
        }
    }

    static void AES_ctx_init(struct AES_ctx_struct* ctx, const U8* key) {
        KeyExpansion(ctx->RoundKey, key);
    }

    /*
    * This function adds the round key to state.
    * The round key is added to the state by an XOR function.
    */
    static void AddRoundKey(U8 round, state_t* state, const U8* RoundKey) {
        U8 i, j;

        for (i = 0; i < 4; ++i) {
            for (j = 0; j < 4; ++j) {
                (*state)[i][j] ^= RoundKey[(round * Nb * 4) + (i * Nb) + j];
            }
        }
    }


    /*
    * The SubBytes Function Substitutes the values in the
    * state matrix with values in an S-box.
    */
    static void SubBytes(state_t* state) {
        U8 i, j;

        for (i = 0; i < 4; ++i) {
            for (j = 0; j < 4; ++j) {
                (*state)[j][i] = getSBoxValue((*state)[j][i]);
            }
        }
    }

    /*
    * The ShiftRows() function shifts the rows in the state to the left.
    * Each row is shifted with different offset.
    * Offset = Row number. So the first row is not shifted.
    */
    static void ShiftRows(state_t* state) {
        U8 temp;

        /* Rotate first row 1 columns to left */
        temp           = (*state)[0][1];
        (*state)[0][1] = (*state)[1][1];
        (*state)[1][1] = (*state)[2][1];
        (*state)[2][1] = (*state)[3][1];
        (*state)[3][1] = temp;

        /* Rotate second row 2 columns to left */
        temp           = (*state)[0][2];
        (*state)[0][2] = (*state)[2][2];
        (*state)[2][2] = temp;

        temp           = (*state)[1][2];
        (*state)[1][2] = (*state)[3][2];
        (*state)[3][2] = temp;

        /* Rotate third row 3 columns to left */
        temp           = (*state)[0][3];
        (*state)[0][3] = (*state)[3][3];
        (*state)[3][3] = (*state)[2][3];
        (*state)[2][3] = (*state)[1][3];
        (*state)[1][3] = temp;
    }

    static U8 xtime(U8 x) {
        return ((x << 1) ^ (((x >> 7) & 1) * 0x1b));
    }

    /* MixColumns function mixes the columns of the state matrix */
    static void MixColumns(state_t* state) {
        U8 i;
        U8 Tmp, Tm, t;

        for (i = 0; i < 4; ++i) {
            t   = (*state)[i][0];
            Tmp = (*state)[i][0] ^ (*state)[i][1] \
                    ^ (*state)[i][2] ^ (*state)[i][3];

            Tm  = (*state)[i][0] ^ (*state)[i][1];
            Tm = xtime(Tm);
            (*state)[i][0] ^= Tm ^ Tmp;

            Tm  = (*state)[i][1] ^ (*state)[i][2];
            Tm = xtime(Tm);
            (*state)[i][1] ^= Tm ^ Tmp;

            Tm  = (*state)[i][2] ^ (*state)[i][3];
            Tm = xtime(Tm);
            (*state)[i][2] ^= Tm ^ Tmp;

            Tm  = (*state)[i][3] ^ t;
            Tm = xtime(Tm);
            (*state)[i][3] ^= Tm ^ Tmp;
        }
    }

    /*
    * Multiply is used to multiply numbers in the field GF(2^8)
    * Note: The last call to xtime() is unneeded, but often ends up generating a smaller binary
    *       The compiler seems to be able to vectorize the operation better this way.
    *       See https://github.com/kokke/tiny-AES-c/pull/34
    */
    #if MULTIPLY_AS_A_FUNCTION
        static U8 Multiply(U8 x, U8 y) {
            return (((y & 1) * x) ^                         \
                ((y>>1 & 1) * xtime(x)) ^                   \
                ((y>>2 & 1) * xtime(xtime(x))) ^            \
                ((y>>3 & 1) * xtime(xtime(xtime(x)))) ^     \
                ((y>>4 & 1) * xtime(xtime(xtime(xtime(x))))));
                /* this last call to xtime() can be omitted */
        }
    #else
        #define Multiply(x, y)                              \
            (((y & 1) * x) ^                                \
            ((y>>1 & 1) * xtime(x)) ^                       \
            ((y>>2 & 1) * xtime(xtime(x))) ^                \
            ((y>>3 & 1) * xtime(xtime(xtime(x)))) ^         \
            ((y>>4 & 1) * xtime(xtime(xtime(xtime(x))))))   \

    #endif

    /*
    * MixColumns function mixes the columns of the state matrix.
    * The method used to multiply may be difficult to understand for the inexperienced.
    * Please use the references to gain more information.
    */
    static void InvMixColumns(state_t* state) {
        int i;
        U8 a, b, c, d;

        for (i = 0; i < 4; ++i) {
            a = (*state)[i][0];
            b = (*state)[i][1];
            c = (*state)[i][2];
            d = (*state)[i][3];

            (*state)[i][0] = Multiply(a, 0x0e) ^ Multiply(b, 0x0b) ^ \
                                Multiply(c, 0x0d) ^ Multiply(d, 0x09);
            (*state)[i][1] = Multiply(a, 0x09) ^ Multiply(b, 0x0e) ^ \
                                Multiply(c, 0x0b) ^ Multiply(d, 0x0d);
            (*state)[i][2] = Multiply(a, 0x0d) ^ Multiply(b, 0x09) ^ \
                                Multiply(c, 0x0e) ^ Multiply(d, 0x0b);
            (*state)[i][3] = Multiply(a, 0x0b) ^ Multiply(b, 0x0d) ^ \
                                Multiply(c, 0x09) ^ Multiply(d, 0x0e);
        }
    }


    /* The SubBytes Function Substitutes the values in the...
    *  ...state matrix with values in an S-box.
    */
    static void InvSubBytes(state_t* state) {
        U8 i, j;

        for (i = 0; i < 4; ++i) {
            for (j = 0; j < 4; ++j) {
                (*state)[j][i] = getSBoxInvert((*state)[j][i]);
            }
        }
    }

    static void InvShiftRows(state_t* state) {
        U8 temp;

        /*
        * Rotate first row 1 columns to right
        */
        temp = (*state)[3][1];
        (*state)[3][1] = (*state)[2][1];
        (*state)[2][1] = (*state)[1][1];
        (*state)[1][1] = (*state)[0][1];
        (*state)[0][1] = temp;

        /*
        * Rotate second row 2 columns to right 
        */
        temp = (*state)[0][2];
        (*state)[0][2] = (*state)[2][2];
        (*state)[2][2] = temp;

        temp = (*state)[1][2];
        (*state)[1][2] = (*state)[3][2];
        (*state)[3][2] = temp;

        /*
        * Rotate third row 3 columns to right
        */
        temp = (*state)[0][3];
        (*state)[0][3] = (*state)[1][3];
        (*state)[1][3] = (*state)[2][3];
        (*state)[2][3] = (*state)[3][3];
        (*state)[3][3] = temp;
    }



    /*
*------>Cipher and InvCipher
    */
    static void Cipher(state_t *state_2darr, const U8 *RoundKey) {
        /*
                  How does AES-ENCRYPTION work?
        
                           +------------+  
                           | Plain text |
                           +-----|------+ 
                                 |
                         +-------V--------+
            (1st round)  | Add Round Keys |    +--------------+  
                         +-------|--------+    |              |     (11th round: last)
                ---------------->+             |              |
                |          +-----V-----+       |        +-----V-----+
                |          | Sub Bytes |       |        | Sub Bytes |
                |          +-----|-----+       |        +-----|-----+
                |                |             |              |
                |          +-----V------+      |        +-----V------+
                |          | Shift Rows |      |        | Shift Rows |
                |          +-----|------+      |        +-----|------+
                |                |             |              |
                |          +-----V------+      ^              |
    (round 1-9) |          | MixColumns |      |              |     (no MixColumns)
                |          +-----|------+      |              |
                |                |             |              |
                |        +-------V--------+    |      +-------V--------+
                |        | Add Round Keys |    |      | Add Round Keys |
                |        +-------|--------+    |      +-------|--------+
                |                |             |              |
                |           +----V------+      |       +------V-------+
                +------NO--< Round = 10? >--YES-+     ( ENCRYPTED TEXT )
                            +-----------+              +--------------+
        */





        /* Initialize variable */
        U8 round = 0;

        /*  
        * round=0
        */
        AddRoundKey(round, state_2darr, RoundKey);

        /*
        * round=1-10
        * Note: If round=10 (Last one), then do NOT run 'MixColumns'
        */
        for (round = 1; round <= Nr; ++round) {
            SubBytes(state_2darr);
            ShiftRows(state_2darr);

            /* 
            * Only for round=1-9
            * Note: skip this part for the last round=10
            */
            if (round < Nr) {
                MixColumns(state_2darr);
            }

            AddRoundKey(round, state_2darr, RoundKey);
        }

        // /* Add round key to last round */
        // AddRoundKey(Nr, state_2darr, RoundKey);
    }

    static void InvCipher(state_t* state_2darr, const U8* RoundKey) {
        /*
                  How does AES-DECRYPTION work?
                          +-------------+  
                          | Cypher text |
                          +------|------+ 
                                 |
                         +-------V--------+
            (1st round)  | Add Round Keys |    +--------------+  
                         +-------|--------+    |              |     (11th round: last)
                ---------------->+             |              |
                |        +-------V--------+    |      +-------V--------+
                |        | Inv Shift Rows |    |      | Inv Shift Rows |
                |        +-------|--------+    |      +-------|--------+
                |                |             |              |
                |        +-------V-------+     |      +-------V-------+
                |        | Inv Sub Bytes |     |      | Inv Sub Bytes |
                |        +-------|-------+     |      +-------|-------+
                |                |             |              |
                |        +-------V--------+    ^              |
    (round 1-9) |        | Add Round Keys |    |              |     (no MixColumns)
                |        +-------|--------+    |              |
                |                |             |              |
                |        +-------V--------+    |      +-------V--------+
                |        | Inv MixColumns |    |      | Add Round Keys |
                |        +-------|--------+    |      +-------|--------+
                |                |             |              |
                |           +----V-----+       |         +-V-------+
                +------NO--< Round = 10? >--YES-+       ( PLAN TEXT )
                            +----------+                 +---------+
        */
        /*
        * Initialize variable
        * Start with round=Nr
        */
        U8 round = Nr;

        /*  
        * round=Nr
        */
        AddRoundKey(round, state_2darr, RoundKey);

        /*
        * round=1-10
        * Note: If round=10 (Last one), then do NOT run 'InvMixColumns'
        */
        for (round = 1; round <= Nr; ++round) {
            InvShiftRows(state_2darr);
            InvSubBytes(state_2darr);
            /*
            * Notice: when round=Nr, then (Nr-round)=0
            * Thus: AddRoundKey(0, state_2darr, RoundKey)
            */
            AddRoundKey((Nr-round), state_2darr, RoundKey);

            /* 
            * Only for round=1-9
            * Note: skip this part for the last round=10
            */
            if (round < Nr) {
                InvMixColumns(state_2darr);
            }
        }
    }

    static void AES_Xcrypt(U8 *key_1darr_in, \
                                    U8 *data_1darr_in, \
                                        const U8 &data_1darr_len_in, \
                                            const char *const xcrypt_type) {
        /*
        * Encryptes or Decrypted Data
        * Input Parameters:
        * - key_1darr_in: HEX key-array
        * - data_1darr_in: HEX plain-text or encrypted-text (1d-array)
        * - data_1darr_len_in: length of data_1darr_in
        * - xcrypt_arr_out: HEX encrypted-text or plain-text (1d-array)
        * - xcrypt_type: ENCRYPT or DECRYPT
        */

        struct AES_ctx_struct ctx;
        /* 
        * CREATE & INIT the context 'ctx' for the specified 'key_hex_arr'
        *   input: &ctx (ADDRESS), key_hex_arr
        *   output: ctx
        * NOTE:
        *   'ctx' is a structure which is defined by 'AES_ctx_struct'
        *   'RoundKey' is an object which is a 'member' of 'AES_ctx_struct'
        */
        AES_ctx_init(&ctx, key_1darr_in);

        /*
        * &ctx->Roundkey: DEREFERENCE 'ctx', Point to structure-object 'RoundKey'
        */
        U8 *roundkey_ptr = (&ctx)->RoundKey;


        /* ENCRYPT or DECRYPT */
        // U8 *data16b_block_1darr_ptr;
        // state_t *data16b_block_2darr_ptr;

        /* 
        * Cycle through 'data_1darr_in' in BLOCKS of 16 Bytes 'BLOCKSIZE_16'
        */ 
        for (U8 i = 0; i < (data_1darr_len_in/BLOCKSIZE_16); ++i) {
            /* 
            * Get chunks of 'data_1darr_in' which is AT LEAST '16 Bytes' long
            * REMARK:
            *   It does NOT matter that 'data16b_block_1darr_ptr' is 
            *   LONGER (but NOT shorter!) than 16 Bytes, because 
            *   once 'data16b_block_1darr_ptr' is converted from 
            *   1D-array[16 or longer] to 2D-array [4x4], 
            *   ONLY 16 Bytes of 'data16b_block_1darr_ptr' is used 
            *   (counting from left to right).
            */
            U8 *data16b_block_1darr_ptr = data_1darr_in + (i * BLOCKSIZE_16);
            /*
            * Convert 1D-array[16 or longer] to 2D-array[4x4]
            */
            state_t *data16b_block_2darr_ptr = \
                reinterpret_cast<state_t*>(data16b_block_1darr_ptr);

            /*
            * Encrypt or Decrypt data_1darr_in's BLOCK 'data16b_block_2darr_ptr'
            * Input: data16b_block_2darr_ptr 
            * Output: data16b_block_2darr_ptr
            * 
            * NOTE:
            * For each input:
            *   data16b_block_1darr_ptr => data16b_block_2darr_ptr
            * that is passed into 'Cipher' or 'InvCipher', 
            * its respective output: 
            *   data16b_block_2darr_ptr => data16b_block_1darr_ptr
            * modifies the original array 'data_1darr_in'
            * in blocks of 16 Bytes.
            */
            if (xcrypt_type == XCRYPT_ENCRYPT) {
                Cipher(data16b_block_2darr_ptr, roundkey_ptr);
            } else {
                InvCipher(data16b_block_2darr_ptr, roundkey_ptr);
            }
        }
    }
    static std::string AES_Ecb_Handler(const std::string &key, \
                                        const std::string &strdata, \
                                            const char *const xcrypt_type) {
        /* LENGTHS */
        U8 AesKeyLen = U8(AES_KEYLEN);  /* see ntios_aes.h */
        U8 KeyOrgLen = key.size();
        U8 StrDataLenOrg = strdata.size();  /* initial length of 'strdata' */

        /* CHECK key-length */
        /*
        * REMARK: 
        *   If key-legnth is NOT equal to AesKeyLen 16 (AES-128) or 32(AES-256),
        *   then return a NULL-STRING value.
        */
        if (KeyOrgLen != AesKeyLen) {
            return TB_EMPTYSTRING;
        }

        /* CHECK cypher-length */
        /*
        * REMARK:
        *   This check is only required for cypher-text data.
        *   Cypher-text data, must consist of one or more complete 16-character blocks, 
        *       or NULL string will be returned
        */
        if (xcrypt_type == XCRYPT_DECRYPT) {
            if (StrDataLenOrg%BLOCKSIZE_16 != 0) {
                return TB_EMPTYSTRING;
            }
        }



        /* KEY: covert String to Hex */
        U8 key_hex_arr[KeyOrgLen];
        Arr_Str2Hex(key, key_hex_arr, KeyOrgLen, KeyOrgLen, AesKeyLen);

        /* PLAIN: covert String to Hex */
        U8 StrDataLen = CalcPaddLen(StrDataLenOrg, BLOCKSIZE_16);
        U8 strdata_hex_arr[StrDataLen];

        Arr_Str2Hex(strdata, \
                        strdata_hex_arr, \
                            StrDataLenOrg, \
                                StrDataLen, \
                                    BLOCKSIZE_16);
        /* REMARK: this method outputs 'strdata_hex_arr' */

        /* ENCRYPT */
        /*
        * Define Output Array
        * REMARK: regarding 'xcrypt_hex_arr_ptr'
        *  -    Input: strdata-text
        *  -    Output: encrypted-text
        */
        U8 *xcrypt_hex_arr_ptr = strdata_hex_arr;
        U8 xcrypt_hex_arr_len = StrDataLen;
        AES_Xcrypt(key_hex_arr, \
                        xcrypt_hex_arr_ptr, \
                            xcrypt_hex_arr_len, \
                                xcrypt_type);

        /* CONVERT: Hex to String */
        std::string xcrypted_string = Arr_Hex2Str(xcrypt_hex_arr_ptr, \
                                                    xcrypt_hex_arr_len, \
                                                        xcrypt_type);

        /* OUTPUT */
        return xcrypted_string;
    }
    static U8 CalcPaddLen(const U8 &org_len, const U8 &block_size) {
        /* 
        * This method calculates the padded array-length
        * For example: 
        * If the original array-length is 40, which is not a multiple of...
        * 'block_size' is 16 (AES128) or 32 (AES256), then...
        * the padded array-length is 48 (for AES128) or 64 (for AES256).

        *
        * Calculate the 'desired' length for 'plain'
        * Modulus: x % y yields the remainder after divsion x/y
        * REMARK: due to the addition of '!=0', if 'x % y' is NOT zero, then...
        *         ...the result of 'x % y != 0' is always '1'.
        *         In other words Round-Up
        */
        U8 mod = org_len % block_size != 0;
        U8 multipl = (org_len/block_size) + mod; /* multipl=0,1,2,... */

        return (multipl*block_size);
    }

    static void Arr_Str2Hex(const std::string &str_in, U8 *arr_out, \
                                const U8 &org_len, const U8 &padd_len, \
                                    const U8 &block_size) {
        /*
        Method converts String into Hex-Array
        * Output parameters:
        *   arr_out: hex-array
        */

        std::string str;
        U8 hex;
        U8 i = 0;
        for (U8 k = 0; k < org_len; ++k) {
            /* 1 character of 'key' (string) */
            str = str_in[k];

            /* Convert chr to hex (use the same function as for ascii) */
            hex = ntios::conv::asc(str);

            /* Put 'key_hex' in array 'key_hex_arr' */
            arr_out[i++] = hex;
        }

        /*
        * PADDING REQUIRED?
        *
        * Difference between last 'p' value and 'AesKeyLen' 
        * REMARKS:
        * 1. last 'p' value is always 'StrDataLenOrg'
        * 2. if 'len_diff = 0', then No Padding required!
        * 3. else if 'len_diff !=0, then Padding needed by appending '0x00' until length is 16-bit
        */
        if (org_len != padd_len) {
            U8 len_diff = (padd_len - i);

            for (U8 d = 0; d < len_diff; ++d) {
                arr_out[i++] = HEXNULL;
            }
        }
    }

    static std::string Arr_Hex2Str(U8 *arr_in_ptr, \
                                    const U8 &padd_len, \
                                        const char *const xcrypt_type) {
        /*
        Method converts  Hex-Array into String
        */

        /* Define variables */
        std::string str_item, str_out;
        U8 hex_item;

        for (U8 i = 0; i < padd_len; i++) {
            /* Get hex-value */
            hex_item = arr_in_ptr[i];

            /* 
            * Add 'hex_item' to 'str'
            * REMARK: 
            *   When DECRYPTING, only add to 'str_out' if 'hex_item != 0x00'
            */
            if (xcrypt_type == XCRYPT_ENCRYPT) {
                str_item = ntios::conv::chr(hex_item);
                str_out = str_out + str_item;
            } else {
                if (hex_item != HEXNULL) {
                    str_item = ntios::conv::chr(hex_item);
                    str_out = str_out + str_item;
                }
            }
        }

        /* Output */
        return str_out;
    }



    /*
    %%%%%%%%%%%%%%%%%%%%
    % PUBLIC FUNCTIONS %
    %%%%%%%%%%%%%%%%%%%%
    */
    std::string aes128enc(const std::string &key, const std::string &plain) {
        /*
        * Method:
        *   Encrypts data in 16-byte blocks according to the AES128 algorithm.
        * Input:
        *   key: Encryption key. Must be 16 characters long, or Empty String will be returned.
        *   plain: Plain (unencrypted) data. Will be processed in 16-byte blocks. 
        *          Last incomplete block will be padded with zeroes.
        */
        return AES_Ecb_Handler(key, plain, XCRYPT_ENCRYPT);
    }

    std::string aes128dec(const std::string &key, const std::string &cypher) {
        /*
        * Method:
        *   Decrypts data in 16-byte blocks according to the AES128 algorithm.
        * Input:
        *   Encryption key. Must be 16 characters long, or Empty String will be returned.
        *   cypher: Encrypted data, must consist of one or more complete 16-character blocks,
        *           or Empty String will be returned.
        */
        return AES_Ecb_Handler(key, cypher, XCRYPT_DECRYPT);
    }

}  // namespace aes
}  // namespace ntios
