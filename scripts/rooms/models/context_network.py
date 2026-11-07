"""Whole-page RGB overview conditions native-resolution structural tiles."""
from __future__ import annotations

import torch
from torch import nn
from torch.nn import functional as F

from common import HEADS
from network import Block, StructuralUNet

VERSION = "whole-sheet-context-v2"


class LocalUNet(StructuralUNet):
    def __init__(self, base=16):
        super().__init__(base)
        self.down[0] = Block(3 + len(HEADS), base)


def aligned_context(probability, boxes, size):
    """Crop coarse cues at the exact page coordinates of each local tile."""
    height, width = size
    yy = (torch.arange(height, device=probability.device, dtype=torch.float32) + 0.5) / height
    xx = (torch.arange(width, device=probability.device, dtype=torch.float32) + 0.5) / width
    x = boxes[:, 0, None, None] + xx[None, None, :] * (boxes[:, 2] - boxes[:, 0])[:, None, None]
    y = boxes[:, 1, None, None] + yy[None, :, None] * (boxes[:, 3] - boxes[:, 1])[:, None, None]
    grid = torch.stack([x.expand(-1, height, -1), y.expand(-1, -1, width)], dim=-1) * 2 - 1
    return F.grid_sample(probability.float(), grid, mode="bilinear", padding_mode="zeros", align_corners=False)


class ContextUNet(nn.Module):
    def __init__(self, base=16, context_base=8):
        super().__init__()
        self.overview = StructuralUNet(context_base)
        self.local = LocalUNet(base)

    def local_logits(self, tiles, coarse, boxes):
        context = aligned_context(coarse.sigmoid(), boxes, tiles.shape[-2:])
        return self.local(torch.cat([tiles, context.to(tiles.dtype)], dim=1))

    def forward(self, tiles, overview, boxes):
        coarse = self.overview(overview)
        return self.local_logits(tiles, coarse, boxes), coarse
