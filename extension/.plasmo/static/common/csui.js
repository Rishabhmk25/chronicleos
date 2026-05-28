async function createShadowDOM(Mount) {
  const shadowHost = document.createElement("plasmo-csui");

  const shadowRoot =
    typeof Mount.createShadowRoot === "function"
      ? await Mount.createShadowRoot(shadowHost)
      : shadowHost.attachShadow({ mode: "open" });

  const shadowContainer = document.createElement("div");

  shadowContainer.id = "plasmo-shadow-container";
  shadowContainer.style.zIndex = "2147483647";
  shadowContainer.style.position = "relative";

  shadowRoot.appendChild(shadowContainer);

  return {
    shadowHost,
    shadowRoot,
    shadowContainer,
  };
}

async function injectAnchor(
  Mount,
  anchor,
  { shadowHost, shadowRoot },
  mountState,
) {
  if (typeof Mount.getStyle === "function") {
    const sfcStyleContent =
      typeof Mount.getSfcStyleContent === "function"
        ? await Mount.getSfcStyleContent()
        : "";
    shadowRoot.prepend(await Mount.getStyle({ ...anchor, sfcStyleContent }));
  }

  if (typeof Mount.getShadowHostId === "function") {
    shadowHost.id = await Mount.getShadowHostId(anchor);
  }

  if (typeof Mount.mountShadowHost === "function") {
    await Mount.mountShadowHost({
      shadowHost,
      anchor,
      mountState,
    });
  } else if (anchor.type === "inline") {
    anchor.element.insertAdjacentElement(
      anchor.insertPosition || "afterend",
      shadowHost,
    );
  } else {
    document.documentElement.prepend(shadowHost);
  }
}

export async function createShadowContainer(Mount, anchor, mountState) {
  const shadowDom = await createShadowDOM(Mount);

  mountState?.hostSet.add(shadowDom.shadowHost);
  mountState?.hostMap.set(shadowDom.shadowHost, anchor);

  await injectAnchor(Mount, anchor, shadowDom, mountState);

  return shadowDom.shadowContainer;
}

const isVisible = (el) => {
  if (!el) {
    return false;
  }
  const elementRect = el.getBoundingClientRect();
  const elementStyle = globalThis.getComputedStyle(el);

  // console.log(elementRect, elementStyle)

  if (elementStyle.display === "none") {
    return false;
  }

  if (elementStyle.visibility === "hidden") {
    return false;
  }

  if (elementStyle.opacity === "0") {
    return false;
  }

  if (
    elementRect.width === 0 &&
    elementRect.height === 0 &&
    elementStyle.overflow !== "hidden"
  ) {
    return false;
  }

  // Check if the element is irrevocably off-screen:
  if (
    elementRect.x + elementRect.width < 0 ||
    elementRect.y + elementRect.height < 0
  ) {
    return false;
  }

  return true;
};

export function createAnchorObserver(Mount) {
  const mountState = {
    document: document || window.document,
    observer: null,

    mountInterval: null,

    isMounting: false,
    isMutated: false,

    hostSet: new Set(),
    hostMap: new WeakMap(),

    overlayTargetList: [],
  };

  const isMounted = (el) =>
    el?.id
      ? !!document.getElementById(el.id)
      : el?.getRootNode({ composed: true }) === mountState.document;

  const hasInlineAnchor = typeof Mount.getInlineAnchor === "function";
  const hasOverlayAnchor = typeof Mount.getOverlayAnchor === "function";

  const hasInlineAnchorList = typeof Mount.getInlineAnchorList === "function";
  const hasOverlayAnchorList = typeof Mount.getOverlayAnchorList === "function";

  const shouldObserve =
    hasInlineAnchor ||
    hasOverlayAnchor ||
    hasInlineAnchorList ||
    hasOverlayAnchorList;

  if (!shouldObserve) {
    return null;
  }

  async function mountAnchors(render) {
    mountState.isMounting = true;

    const mountedInlineAnchorSet = new WeakSet();

    // There should only be 1 overlay mount
    let overlayHost = null;

    // Go through mounted sets and check if they are still mounted
    for (const el of mountState.hostSet) {
      if (isMounted(el)) {
        const anchor = mountState.hostMap.get(el);
        if (!!anchor) {
          if (anchor.type === "inline") {
            mountedInlineAnchorSet.add(anchor.element);
          } else if (anchor.type === "overlay") {
            overlayHost = el;
          }
        }
      } else {
        const anchor = mountState.hostMap.get(el);
        anchor.root?.unmount();
        mountState.hostSet.delete(el);
      }
    }

    const [inlineAnchor, inlineAnchorList, overlayAnchor, overlayAnchorList] =
      await Promise.all([
        hasInlineAnchor ? Mount.getInlineAnchor() : null,
        hasInlineAnchorList ? Mount.getInlineAnchorList() : null,
        hasOverlayAnchor ? Mount.getOverlayAnchor() : null,
        hasOverlayAnchorList ? Mount.getOverlayAnchorList() : null,
      ]);

    const renderList = [];

    if (!!inlineAnchor) {
      if (inlineAnchor instanceof Element) {
        if (!mountedInlineAnchorSet.has(inlineAnchor)) {
          renderList.push({
            element: inlineAnchor,
            type: "inline",
          });
        }
      } else if (
        inlineAnchor.element instanceof Element &&
        !mountedInlineAnchorSet.has(inlineAnchor.element)
      ) {
        renderList.push({
          element: inlineAnchor.element,
          type: "inline",
          insertPosition: inlineAnchor.insertPosition,
        });
      }
    }

    if ((inlineAnchorList?.length || 0) > 0) {
      inlineAnchorList.forEach((inlineAnchor) => {
        if (
          inlineAnchor instanceof Element &&
          !mountedInlineAnchorSet.has(inlineAnchor)
        ) {
          renderList.push({
            element: inlineAnchor,
            type: "inline",
          });
        } else if (
          inlineAnchor.element instanceof Element &&
          !mountedInlineAnchorSet.has(inlineAnchor.element)
        ) {
          renderList.push({
            element: inlineAnchor.element,
            type: "inline",
            insertPosition: inlineAnchor.insertPosition,
          });
        }
      });
    }

    const overlayTargetList = [];

    if (!!overlayAnchor && isVisible(overlayAnchor)) {
      overlayTargetList.push(overlayAnchor);
    }

    if ((overlayAnchorList?.length || 0) > 0) {
      overlayAnchorList.forEach((el) => {
        if (el instanceof Element && isVisible(el)) {
          overlayTargetList.push(el);
        }
      });
    }

    if (overlayTargetList.length > 0) {
      mountState.overlayTargetList = overlayTargetList;
      if (!overlayHost) {
        renderList.push({
          element: document.documentElement,
          type: "overlay",
        });
      } else {
        // force re-render
      }
    } else {
      overlayHost?.remove();
      mountState.hostSet.delete(overlayHost);
    }

    await Promise.all(renderList.map(render));

    if (mountState.isMutated) {
      mountState.isMutated = false;
      await mountAnchors(render);
    }

    mountState.isMounting = false;
  }

  const start = (render) => {
    mountState.observer = new MutationObserver(() => {
      if (mountState.isMounting) {
        mountState.isMutated = true;
        return;
      }
      mountAnchors(render);
    });

    // Need to watch the subtree for shadowDOM
    mountState.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    mountState.mountInterval = setInterval(() => {
      if (mountState.isMounting) {
        mountState.isMutated = true;
        return;
      }
      mountAnchors(render);
    }, 142);
  };

  return {
    start,
    mountState,
  };
}

export const createRender = (Mount, containers, mountState, renderFx) => {
  const createRootContainer = (anchor) =>
    typeof Mount.getRootContainer === "function"
      ? Mount.getRootContainer({
          anchor,
          mountState,
        })
      : createShadowContainer(Mount, anchor, mountState);

  if (typeof Mount.render === "function") {
    return (anchor) =>
      Mount.render(
        {
          anchor,
          createRootContainer,
        },
        ...containers,
      );
  }

  return async (anchor) => {
    const rootContainer = await createRootContainer(anchor);
    return renderFx(anchor, rootContainer);
  };
};
