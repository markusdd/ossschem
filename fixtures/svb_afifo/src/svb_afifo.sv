// Copyright (c) 2020 The SV Base Library Contributors
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this hardware, software, and associated documentation files
// (the "Product"), to deal in the Product without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Product,
// and to permit persons to whom the Product is furnished to do so,
// subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Product.
//
// THE PRODUCT IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
// OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE PRODUCT
// OR THE USE OR OTHER DEALINGS IN THE PRODUCT.

module svb_afifo #(
  parameter DATA_WIDTH = 32,
  parameter DEPTH = 16,
  parameter RDATA_REG = 1
) (
  //write side
  input logic clk_w_i,
  input logic rst_w_an_i,
  input logic wen_i,
  input logic [DATA_WIDTH-1:0] wdata_i,
  output logic full_o,
  output logic werr_o,
  //read side
  input logic clk_r_i,
  input logic rst_r_an_i,
  input logic ren_i,
  output logic [DATA_WIDTH-1:0] rdata_o,
  output logic empty_o,
  output logic rerr_o
);

  //elaboration time param checks (DEPTH must be a power of 2 and larger than 0, the latter for DATA_WIDTH as well)
  if ((DEPTH <= 0) || ((DEPTH & (DEPTH - 1)) != 0)) begin
    $error("SVB IP ERROR: DEPTH parameter is not a power of 2, which is required by the AFIFO.");
  end

  if (DATA_WIDTH <= 0) begin
    $error("SVB IP ERROR: DATA_WIDTH parameter is not greater than 0.");
  end

  //declarations
  localparam ADDR_WIDTH_P = $clog2(DEPTH);

  logic [DATA_WIDTH-1:0] fifo_mem_r [DEPTH-1:0];
  logic [DATA_WIDTH-1:0] rdata_r;

  logic full_s;
  logic full_r;
  logic empty_s;
  logic empty_r;

  logic [ADDR_WIDTH_P:0] bin_wpointer_next_s;
  logic [ADDR_WIDTH_P:0] gray_wpointer_next_s;
  logic [ADDR_WIDTH_P:0] bin_wpointer_r;
  logic [ADDR_WIDTH_P:0] gray_wpointer_r;
  logic [ADDR_WIDTH_P:0] gray_wpointer_sync_s;

  logic [ADDR_WIDTH_P:0] bin_rpointer_next_s;
  logic [ADDR_WIDTH_P:0] gray_rpointer_next_s;
  logic [ADDR_WIDTH_P:0] bin_rpointer_r;
  logic [ADDR_WIDTH_P:0] gray_rpointer_r;
  logic [ADDR_WIDTH_P:0] gray_rpointer_sync_s;

  //business logic

  //actual fifo memory
  always_ff @(posedge clk_w_i) begin : proc_fifo_mem_w
    if ((wen_i == 1'b1) && (full_r == 1'b0)) begin
      fifo_mem_r[bin_wpointer_r[ADDR_WIDTH_P-1:0]] <= wdata_i;
    end
  end

  //handle read data, buffered or not
  if (RDATA_REG == 1) begin
    always_ff @(posedge clk_r_i) begin : proc_fifo_mem_r
      if (ren_i == 1'b1) begin
         rdata_r <= fifo_mem_r[bin_rpointer_r[ADDR_WIDTH_P-1:0]];
      end
    end

    assign rdata_o = rdata_r;
  end else if (RDATA_REG == 0) begin
    assign rdata_o = fifo_mem_r[bin_rpointer_r[ADDR_WIDTH_P-1:0]];
  end else begin
    $error("SVB IP ERROR: RDATA_REG parameter has to be either 0 or 1.");
  end

  //pointer increments, gray conversions and flags
  always_comb begin : proc_pointer_next
      //read pointers
      bin_rpointer_next_s = bin_rpointer_r + {{ADDR_WIDTH_P{1'b0}}, 1'b1 & ren_i & ~empty_r};
      gray_rpointer_next_s = (bin_rpointer_next_s>>1) ^ bin_rpointer_next_s;
      //write pointers
      bin_wpointer_next_s = bin_wpointer_r + {{ADDR_WIDTH_P{1'b0}}, 1'b1 & wen_i & ~full_r};
      gray_wpointer_next_s = (bin_wpointer_next_s>>1) ^ bin_wpointer_next_s;
      //empty flag
      empty_s = (gray_rpointer_next_s == gray_wpointer_sync_s);
      //full flag
      full_s = (gray_wpointer_next_s == {~gray_rpointer_sync_s[ADDR_WIDTH_P:ADDR_WIDTH_P-1],
                                          gray_rpointer_sync_s[ADDR_WIDTH_P-2:0]});
  end

  //write pointer
  always_ff @(posedge clk_w_i or negedge rst_w_an_i) begin : proc_w_pointer
    if (rst_w_an_i == 1'b0) begin
      bin_wpointer_r <= {ADDR_WIDTH_P+1{1'b0}};
      gray_wpointer_r <= {ADDR_WIDTH_P+1{1'b0}};
    end else if ((wen_i == 1'b1) && (full_r == 1'b0)) begin
      bin_wpointer_r <= bin_wpointer_next_s;
      gray_wpointer_r <= gray_wpointer_next_s;
    end
  end

  //read pointer
  always_ff @(posedge clk_r_i or negedge rst_r_an_i) begin : proc_r_pointer
    if (rst_r_an_i == 1'b0) begin
      bin_rpointer_r <= {ADDR_WIDTH_P+1{1'b0}};
      gray_rpointer_r <= {ADDR_WIDTH_P+1{1'b0}};
    end else if ((ren_i == 1'b1) && (empty_r == 1'b0)) begin
      bin_rpointer_r <= bin_rpointer_next_s;
      gray_rpointer_r <= gray_rpointer_next_s;
    end
  end

  //empty flag and read error registers and output
  always_ff @(posedge clk_r_i or negedge rst_r_an_i) begin : proc_empty
    if(rst_r_an_i == 1'b0) begin
      empty_r <= 1'b1;
      rerr_o <= 1'b0;
    end else begin
      empty_r <= empty_s;
      rerr_o <= ren_i & empty_r;
    end
  end

  assign empty_o = empty_r;

  //full flag and write error registers and output
  always_ff @(posedge clk_w_i or negedge rst_w_an_i) begin : proc_full
    if(rst_w_an_i == 1'b0) begin
      full_r <= 1'b0;
      werr_o <= 1'b0;
    end else begin
      full_r <= full_s;
      werr_o <= wen_i & full_r;
    end
  end

  assign full_o = full_r;

  //synchronizers for gray coded pointers
  genvar i;
  generate
    for (i = 0; i<=ADDR_WIDTH_P; i++) begin : gen_pointer_sync

      svb_sync #(
        .RST_VAL (1'b0)
      ) u_svb_sync_gray_wpointer (
      	.clk_i    (clk_r_i                ),
        .rst_an_i (rst_r_an_i             ),
        .d_i      (gray_wpointer_r[i]     ),
        .d_o      (gray_wpointer_sync_s[i])
      );

      svb_sync #(
        .RST_VAL (1'b0)
      ) u_svb_sync_gray_rpointer (
      	.clk_i    (clk_w_i                ),
        .rst_an_i (rst_w_an_i             ),
        .d_i      (gray_rpointer_r[i]     ),
        .d_o      (gray_rpointer_sync_s[i])
      );

    end
  endgenerate

endmodule