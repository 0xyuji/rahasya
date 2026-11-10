/**
 * The landing page's hooded figure, drawn for a 800 x 1000 box and lit from the
 * right. Painted in order into a mask that the glyph field samples.
 *  - shape:  the whole figure. Glyphs stay out, so it reads as a dark body.
 *  - lit:    cloth catching the light. Bright glyphs.
 *  - shadow: folds and seams cut back out of the lit cloth.
 *  - face:   the empty hood.
 * `width` makes a path a line (drawstrings, seams); without it the path is filled.
 */
export type FigureTone = "shape" | "lit" | "shadow" | "face";
export type FigurePath = { tone: FigureTone; d: string; width?: number };

export const FIGURE_W = 800;
export const FIGURE_H = 1000;

export const FIGURE: FigurePath[] = [
  // Silhouette
  {
    tone: "shape",
    d: "M300 405C268 340 250 262 262 190C276 98 340 38 412 36C492 36 556 100 578 190C596 262 600 330 590 388C640 410 690 428 716 452C752 490 768 570 782 650C794 710 800 760 770 800C740 850 690 900 640 950L650 1000L150 1000L140 940C100 880 80 800 84 720C88 620 104 530 140 470C170 436 240 418 300 405Z",
  },

  // Hood: the lit outer panel, wrapping over the head
  {
    tone: "lit",
    d: "M404 40C488 34 556 100 578 190C596 262 600 330 590 388C566 420 534 440 506 452C528 410 548 372 552 310C556 244 540 176 500 128C466 92 420 78 372 86C346 90 320 104 300 128C326 76 362 42 404 40Z",
  },
  // Hood: the rim of light around the opening
  { tone: "lit", d: "M294 138C272 176 268 252 288 322C306 382 348 428 398 456L404 444C352 412 312 372 298 318C282 256 284 192 306 142Z" },
  { tone: "lit", d: "M372 96C430 86 476 108 508 150C540 200 546 262 540 322C534 376 510 416 470 448L458 440C494 408 516 370 522 320C528 262 520 208 494 164C466 124 424 104 374 106Z" },
  // Hood: creases
  { tone: "shadow", d: "M552 196C566 248 572 300 564 352C560 330 556 300 552 262C550 238 548 216 552 196Z" },
  { tone: "shadow", d: "M470 74C502 92 530 124 546 160C522 132 498 106 462 84Z" },
  { tone: "shadow", d: "M536 382C524 404 508 424 492 436C504 416 518 394 526 372Z" },

  // Chest and belly, right of the zip
  {
    tone: "lit",
    d: "M452 462C498 470 548 446 594 400C640 420 682 436 704 460C690 520 674 590 666 650C660 716 642 768 604 802C596 860 590 930 588 1000L424 1000C430 820 440 630 452 462Z",
  },
  // Chest, left of the zip, cut off by the shadow side
  {
    tone: "lit",
    d: "M414 472C392 492 356 502 322 486C330 520 340 536 330 560C346 572 344 604 326 640C342 668 350 694 338 724C322 760 332 800 326 830C346 880 340 940 348 1000L398 1000C402 820 408 640 414 472Z",
  },
  // The hood's shadow falling on the chest
  { tone: "shadow", d: "M466 468C500 478 544 468 584 428C566 470 538 498 510 506C516 492 492 490 466 468Z" },
  // Fold shadows across the torso
  { tone: "shadow", d: "M660 524C628 548 596 562 556 568C590 576 632 566 664 546Z" },
  { tone: "shadow", d: "M640 640C606 684 568 712 520 728C572 728 620 700 650 662Z" },
  { tone: "shadow", d: "M516 800C494 842 474 880 464 926C492 892 518 850 530 808Z" },
  { tone: "shadow", d: "M398 846C380 876 368 906 362 944C380 918 398 884 406 852Z" },
  { tone: "shadow", d: "M398 620C382 650 372 676 368 708C384 686 398 658 404 626Z" },
  // Pocket opening and its shadow
  { tone: "shadow", d: "M604 802L574 812L566 1000L590 1000C592 930 598 860 604 802Z" },
  { tone: "shadow", width: 7, d: "M520 780L604 802" },

  // Right sleeve, bent at the elbow into the pocket
  {
    tone: "lit",
    d: "M716 468C750 508 764 574 776 648C786 708 790 752 762 794C736 836 692 882 646 930L606 876C640 846 672 812 690 780C676 744 684 700 694 652C702 590 708 526 716 468Z",
  },
  { tone: "shadow", d: "M772 668C740 672 714 692 696 720C724 706 750 696 778 692Z" },
  { tone: "shadow", d: "M782 730C748 726 716 738 694 760C726 752 756 752 784 756Z" },
  { tone: "shadow", d: "M748 812C720 804 692 810 668 826C698 826 724 830 744 838Z" },
  { tone: "shadow", d: "M712 860C688 852 664 858 640 874C666 874 690 878 702 884Z" },
  { tone: "shadow", d: "M764 560C746 586 728 602 708 612C732 610 754 596 770 580Z" },
  { tone: "shadow", d: "M740 490C730 516 720 534 708 548C724 540 738 522 748 502Z" },

  // Left sleeve, almost all in shadow: streaks of light on the folds
  { tone: "lit", d: "M196 470C168 500 146 560 136 628C154 588 176 534 208 494Z" },
  { tone: "lit", d: "M128 680C112 722 108 770 118 812C126 776 134 728 146 690Z" },
  { tone: "lit", d: "M264 480C246 560 248 660 266 770C272 680 272 570 284 486Z" },
  { tone: "lit", d: "M114 836C128 874 150 908 182 934C166 904 152 870 144 830Z" },
  { tone: "lit", d: "M196 820C216 836 240 844 262 846C244 832 224 818 204 806Z" },
  { tone: "lit", d: "M176 738C196 756 220 766 246 768C226 752 206 738 186 726Z" },

  // Zip
  { tone: "lit", width: 9, d: "M432 450C424 620 414 820 410 1000" },

  // Drawstrings: dark outline, then the cord
  { tone: "shadow", width: 22, d: "M392 450C386 520 374 590 364 660" },
  { tone: "lit", width: 9, d: "M392 450C386 520 374 590 364 660" },
  { tone: "shadow", width: 22, d: "M482 440C490 520 480 610 462 690" },
  { tone: "lit", width: 9, d: "M482 440C490 520 480 610 462 690" },
  { tone: "lit", d: "M358 656L372 660L368 690L354 686Z" },
  { tone: "lit", d: "M456 686L470 690L464 722L450 718Z" },

  // The empty face, last so nothing crosses it
  {
    tone: "face",
    d: "M385 106C340 106 300 152 294 226C290 310 332 398 405 442C452 416 508 348 516 252C520 172 452 106 385 106Z",
  },
];
