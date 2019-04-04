import React, {Component} from 'react'
import PropTypes from 'prop-types'
import {hot} from 'react-hot-loader'
import {compose, withContext} from 'recompose'
import io from 'io'
import {MuiThemeProvider} from '@material-ui/core/styles'
import theme from 'theme'
import {BrowserRouter as Router, Route, Switch} from 'react-router-dom'
import LandingScreen from 'LandingScreen'

const App = compose(withContext({io: PropTypes.func}, () => ({io})))(
  class App extends Component {
    render() {
      return (
        <Router>
          <MuiThemeProvider theme={theme}>
            <Switch>
              <Route component={LandingScreen} />
            </Switch>
          </MuiThemeProvider>
        </Router>
      )
    }
  },
)

App.propTypes = {
  children: PropTypes.node,
}

export default hot(module)(App)
