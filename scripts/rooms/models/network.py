"""Own compact U-Net architecture; no downloaded pretrained weights."""
import torch
from torch import nn
from torch.nn import functional as F

from common import HEADS


class Block(nn.Module):
    def __init__(self, incoming: int, outgoing: int):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv2d(incoming, outgoing, 3, padding=1, bias=False),
            nn.GroupNorm(min(8, outgoing), outgoing), nn.SiLU(),
            nn.Conv2d(outgoing, outgoing, 3, padding=1, bias=False),
            nn.GroupNorm(min(8, outgoing), outgoing), nn.SiLU(),
        )

    def forward(self, value):
        return self.layers(value)


class StructuralUNet(nn.Module):
    def __init__(self, base: int = 16):
        super().__init__()
        if base < 8 or base % 8:
            raise ValueError("Base width must be a positive multiple of eight")
        widths = [base * (2 ** i) for i in range(5)]
        self.down = nn.ModuleList([Block(3, widths[0])] +
                                  [Block(widths[i - 1], widths[i]) for i in range(1, 5)])
        self.up = nn.ModuleList([Block(widths[i] + widths[i - 1], widths[i - 1]) for i in range(4, 0, -1)])
        self.output = nn.Conv2d(base, len(HEADS), 1)

    def forward(self, image):
        skips = []
        value = image
        for i, block in enumerate(self.down):
            if i:
                value = F.max_pool2d(value, 2)
            value = block(value)
            skips.append(value)
        for block, skip in zip(self.up, reversed(skips[:-1])):
            value = F.interpolate(value, size=skip.shape[-2:], mode="bilinear", align_corners=False)
            value = block(torch.cat([value, skip], dim=1))
        return self.output(value)


def supervised_loss(logits, target, known):
    """Unreviewed/rejected pixels are not negatives; empty heads contribute zero."""
    weights = torch.tensor([1.0, 8.0, 16.0], device=logits.device).view(1, -1, 1, 1)
    bce = F.binary_cross_entropy_with_logits(logits, target, reduction="none", pos_weight=weights)
    bce = (bce * known).sum() / known.sum().clamp_min(1)
    probability = logits.sigmoid() * known
    actual = target * known
    dims = (0, 2, 3)
    dice = 1 - (2 * (probability * actual).sum(dims) + 1) / (probability.sum(dims) + actual.sum(dims) + 1)
    active = (known.sum(dims) > 0).float()
    return bce + (dice * active).sum() / active.sum().clamp_min(1)
