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

module svb_sync #(
  parameter RST_VAL = 1'b0
) (
  input logic clk_i,
  input logic rst_an_i,
  input logic d_i,
  output logic d_o
);
  
  //elaboration time param check (we can't e.g. have x or z)
  if ((RST_VAL != 1'b0) &&( RST_VAL != 1'b1)) begin
    $error("SVB IP ERROR: svb_sync parameter RST_VAL must either be 1'b0 or 1'b1.");
  end

  //declarations
  logic d0_r;
  logic d1_r;

  //business logic
  always_ff @(posedge clk_i or negedge rst_an_i) begin : proc_sync
    if (rst_an_i == 1'b0) begin
      d0_r <= RST_VAL;
      d1_r <= RST_VAL;
    end else begin
      d0_r <= d_i;
      d1_r <= d0_r;
    end
  end

  assign d_o = d1_r;

endmodule
