import React, { forwardRef } from 'react'
import PropTypes from 'prop-types'

import withLoading from '../withLoading/index'
import Tooltip from '../Tooltip'
import IconWithText from '../IconWithText'
import WikiLink from '../WikiLink'
import ItemDetails from '../ItemDetails'
import { useColorModeHighlightSuffix, populateMissingItemAPI } from '../helpers'

const Item = forwardRef(
  (
    {
      id,
      count,
      data,
      component,
      upgrades,
      disableIcon,
      disableText,
      disableLink,
      disableTooltip,
      inline,
      tooltipProps,
      wikiLinkProps,
      ...rest
    },
    ref,
  ) => {
    const highlightSuffix = useColorModeHighlightSuffix()

    const {
      name,
      icon,
      rarity,
      type,
      details: { type: detailsType } = {},
    } = data

    return (
      <Tooltip
        content={
          <ItemDetails
            data={populateMissingItemAPI(data)}
            count={count}
            upgrades={upgrades}
          />
        }
        disabled={disableTooltip}
        {...tooltipProps}
        containerProps={{
          ...tooltipProps.containerProps,
          sx: { maxWidth: 353, ...tooltipProps.containerProps?.sx },
        }}
      >
        <IconWithText
          component={component}
          icon={icon}
          text={
            <>
              {count > 1 && `${count} `}
              {disableLink ? (
                name
              ) : (
                <WikiLink
                  to={name}
                  {...wikiLinkProps}
                  sx={{
                    color: 'inherit',
                    '&:hover': {
                      color: `gw2.rarity.${rarity.toLowerCase()}${highlightSuffix}`,
                    },
                    ...wikiLinkProps?.sx,
                  }}
                />
              )}
            </>
          }
          disableIcon={disableIcon}
          disableText={disableText}
          inline={inline}
          {...rest}
          iconProps={{
            ...(type &&
              detailsType && {
                name: `${type}.${detailsType}`,
              }),
            applyCount: count,
            applyCountProps: {
              sx: {
                top: '0.1em',
                right: '0.1em',
                bottom: 'initial',
                color: `#fee49a`,
              },
            },
            ...rest.iconProps,
          }}
          sx={{
            color: `gw2.rarity.${rarity.toLowerCase()}`,
            ...rest.sx,
          }}
          ref={ref}
        />
      </Tooltip>
    )
  },
)

Item.propTypes = {
  id: PropTypes.number,
  count: PropTypes.number,
  component: PropTypes.elementType,
  data: PropTypes.object.isRequired,
  disableIcon: PropTypes.bool,
  disableText: PropTypes.bool,
  disableLink: PropTypes.bool,
  disableTooltip: PropTypes.bool,
  inline: PropTypes.bool,
  tooltipProps: PropTypes.object,
  wikiLinkProps: PropTypes.object,
  upgrades: PropTypes.array,
}

Item.defaultProps = {
  id: null,
  count: null,
  component: undefined,
  disableIcon: false,
  disableText: false,
  disableLink: false,
  disableTooltip: false,
  inline: true,
  tooltipProps: {},
  wikiLinkProps: {},
  upgrades: null,
}

Item.displayName = 'Item'

export default withLoading()(Item)
